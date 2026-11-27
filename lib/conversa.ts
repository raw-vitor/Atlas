/** Responde, com o LLM, perguntas do assessor sobre o lead e o caso. Somente leitura: não altera o caso. */
import { perguntarJson, type Uso } from "./bedrock";
import { brl, fatosParaPrompt } from "./calc";
import { CanceladoError } from "./cancelamento";
import { avisosDosDados, limparNome, MAX_TRANSCRICAO_CHARS, transcricaoJunta, type Caso } from "./caso";
import { dumpModel } from "./schemas";
import type { Aviso } from "./types";

export const FALHA_PERGUNTA = "Não consegui responder agora. Tente de novo em instantes.";
const MAX_TOKENS = 1500;
const MAX_HISTORICO_PROMPT = 10;
const MAX_MSG_HISTORICO = 1500;

const FONTES = { lead: "dados do lead", carteira: "carteira", transcricao: "transcrição da R1", slides: "slides",
  avisos: "avisos do verificador", historico: "conversa" } as const;
type FontePergunta = keyof typeof FONTES;

const SISTEMA =
  "Você é o assistente do assessor Hunter da EQI Investimentos. Ele está montando o deck da R2 de um lead e faz uma pergunta sobre o caso. " +
  "Responda em português do Brasil, curto (até 6 frases), usando SOMENTE o que está no contexto abaixo. Regras:\n" +
  "- Cite a origem do que disser (ex.: \"a Ana disse na R1 que...\", \"o slide de Decisão diz...\", \"na carteira, o CDB X tem...\").\n" +
  "- Se o dado não estiver no contexto, diga que não encontrou no caso. Não invente nem deduza números, nomes ou falas.\n" +
  "- Se a pergunta for sobre os slides e o contexto disser que eles ainda não foram gerados, diga isso.\n" +
  "- Ao explicar um aviso, use o motivo, o campo e o trecho dele, e diga de onde o valor provavelmente veio (fala do lead, carteira ou cálculo) só se isso estiver no contexto.\n" +
  "- Nunca prometa rentabilidade nem resultado.\n" +
  "- Não repita CPF, número de conta ou agência.\n" +
  "- Você só lê o caso: não diga que alterou nada. Para mudar algo, o assessor pede no chat (ex.: \"o perfil é Moderado\").\n" +
  "Em fontes, marque só os blocos do contexto que você usou: lead, carteira (fatos e ativos), transcricao, slides, avisos (avisos e pendências), historico.";

const SCHEMA = {
  type: "object",
  properties: {
    resposta: { type: "string" },
    fontes: { type: "array", items: { type: "string", enum: Object.keys(FONTES) } },
  },
  required: ["resposta", "fontes"], additionalProperties: false,
};

const STOP = new Set(("a o e as os de da do das dos em no na nos nas um uma uns umas que por porque pra para com sem como qual quais " +
  "quanto quantos quanta quantas quando onde isso esse essa esses essas este esta estes estas aquele aquela ele ela eles elas " +
  "nao sim mais menos muito muita foi ser sao era tem ter tinha esta estao seu sua seus suas meu minha voce lead atlas entao tambem " +
  "pelo pela pelos pelas sobre entre ate mas ou se ja ai aqui la dele dela deles delas isto aquilo coisa fala falou disse").split(" "));
const MULT: Record<string, number> = { mil: 1e3, k: 1e3, mi: 1e6, milhao: 1e6, milhoes: 1e6 };
const NUM = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?:\s*(mil|milhoes|milhao|mi|k)\b)?/g;

const norm = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Valores numéricos do texto: "10 mil", "10.000" e "R$ 10.000,00" viram 10000. */
function numeros(t: string): number[] {
  return [...norm(t).matchAll(NUM)].map((m) =>
    Math.round(Number(`${m[1].replace(/\./g, "")}.${m[2] ?? "0"}`) * (m[3] ? MULT[m[3]] : 1) * 100) / 100);
}
/** Palavras significativas, reduzidas a um radical curto ("retirada"/"retirar" casam). */
function radicais(t: string): string[] {
  const ps = norm(t).replace(NUM, " ").split(/[^a-z]+/).filter((p) => p.length >= 4 && !STOP.has(p) && !(p in MULT));
  return [...new Set(ps.map((p) => p.slice(0, 6)))];
}

/** Transcrição para a pergunta: inteira até o limite; acima dele, só as linhas (com as vizinhas) que citam palavras ou números da pergunta. */
export function trechosDaTranscricao(texto: string, pergunta: string, limite = MAX_TRANSCRICAO_CHARS): string {
  if (texto.length <= limite) return texto;
  const rads = radicais(pergunta), nums = new Set(numeros(pergunta));
  if (!rads.length && !nums.size) return "";
  const linhas = texto.split(/\r\n|\r|\n/);
  const pontos = linhas.map((l) => {
    const palavras = norm(l).split(/[^a-z]+/);
    return rads.filter((r) => palavras.some((p) => p.startsWith(r))).length + 2 * numeros(l).filter((n) => nums.has(n)).length;
  });
  // as linhas com mais termos da pergunta entram primeiro, até o limite; a saída volta à ordem da transcrição
  const ordem = pontos.map((p, i) => [p, i]).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
  const usadas = new Set<number>();
  let tam = 0;
  for (const i of ordem) {
    const novas = [i - 1, i, i + 1].filter((j) => j >= 0 && j < linhas.length && !usadas.has(j));
    const custo = novas.reduce((s, j) => s + linhas[j].length + 1, 0) + 6;
    if (tam + custo > limite) continue;
    novas.forEach((j) => usadas.add(j)); tam += custo;
  }
  const idx = [...usadas].sort((a, b) => a - b);
  return idx.map((j, k) => (k && j !== idx[k - 1] + 1 ? "[...]\n" : "") + linhas[j]).join("\n");
}

/** Aviso estruturado (ou texto antigo) numa linha com motivo, campo, trecho e valor. */
function linhaAviso(a: string | Aviso): string {
  if (typeof a === "string") return `- ${a}`;
  const partes = [a.texto, a.motivo && `motivo: ${a.motivo}`, a.campo && `campo: ${a.campo}`, a.trecho && `trecho: "${a.trecho}"`,
    a.valor != null && `valor: ${brl(a.valor, true)}`, (a.ocorrencias ?? 0) > 1 && `aparece ${a.ocorrencias} vezes`];
  return `- [${a.tipo}] ${partes.filter(Boolean).join(" | ")}`;
}

/** Contexto do caso em blocos rotulados, para o LLM. */
function contexto(caso: Caso, pergunta: string): string {
  const b: string[] = [];
  b.push(caso.lead ? `LEAD:\n${JSON.stringify({ ...caso.lead, primeiro_nome: limparNome(caso.lead.primeiro_nome) })}` : "LEAD: ainda não foi lido");
  if (caso.analise) b.push(`FATOS (calculados da carteira):\n${fatosParaPrompt(caso.analise, caso.lead?.perfil).map((f) => `- ${f}`).join("\n")}`);
  b.push(caso.ativos.length
    ? `ATIVOS:\n${caso.ativos.map((a) => `- ${a.nome} | ${a.classe} | ${brl(a.valor, true)}${a.fora_do_depara ? " | fora do estudo" : ""}`).join("\n")}`
    : "ATIVOS: nenhum ativo lido");
  const r = caso.rascunho;
  b.push(r ? `SLIDES (rascunho gerado):\nALOCAÇÃO: ${dumpModel(r.aloc, "Alocacao")}\nDIAGNÓSTICO: ${dumpModel(r.diag, "Diagnostico")}\nDECISÃO: ${dumpModel(r.dec, "Decisao")}`
    : "SLIDES: ainda não foram gerados");
  const dados = r ? { avisos: r.avisos, pendencias: r.pendencias } : avisosDosDados(caso);
  const avisos: (string | Aviso)[] = [...dados.avisos, ...caso.avisosLeitura];
  b.push(avisos.length ? `AVISOS:\n${avisos.map(linhaAviso).join("\n")}` : "AVISOS: nenhum");
  const pend = [...new Set([...dados.pendencias, ...caso.pendenciasCarteira])];
  b.push(pend.length ? `PENDÊNCIAS:\n${pend.map((p) => `- ${p}`).join("\n")}` : "PENDÊNCIAS: nenhuma");
  const tr = transcricaoJunta(caso);
  if (!tr.texto) b.push("TRANSCRIÇÃO: não recebida");
  else {
    const t = trechosDaTranscricao(tr.texto, pergunta);
    const nota = [tr.aviso, t !== tr.texto && "A transcrição é longa: seguem só os trechos com as palavras da pergunta."].filter(Boolean).join(" ");
    b.push(`TRANSCRIÇÃO DA R1${nota ? ` (${nota})` : ""}:\n${t || "nenhum trecho com as palavras da pergunta"}`);
  }
  const h = [...caso.historico];
  const ult = h[h.length - 1];
  if (ult?.papel === "assessor" && ult.texto.trim() === pergunta.trim()) h.pop(); // a rota já registrou a pergunta atual
  if (h.length) b.push(`HISTÓRICO (mensagens anteriores):\n${h.slice(-MAX_HISTORICO_PROMPT)
    .map((m) => `${m.papel === "assessor" ? "Assessor" : "Atlas"}: ${m.texto.slice(0, MAX_MSG_HISTORICO)}`).join("\n")}`);
  return b.join("\n\n");
}

export async function responderPergunta(caso: Caso, pergunta: string, uso: Uso): Promise<string> {
  try {
    const user = `${contexto(caso, pergunta)}\n\nPERGUNTA DO ASSESSOR:\n${pergunta}`;
    const r = await perguntarJson(SISTEMA, user, SCHEMA, uso, MAX_TOKENS) as { resposta?: unknown; fontes?: unknown } | null;
    const resposta = typeof r?.resposta === "string" ? r.resposta.trim() : "";
    if (!resposta) return FALHA_PERGUNTA;
    const fontes = [...new Set(Array.isArray(r?.fontes) ? r.fontes : [])].filter((f): f is FontePergunta => typeof f === "string" && Object.hasOwn(FONTES, f));
    return fontes.length ? `${resposta}\n\n${fontes.length > 1 ? "Fontes" : "Fonte"}: ${fontes.map((f) => FONTES[f]).join(", ")}.` : resposta;
  } catch (e) { if (e instanceof CanceladoError) throw e; return FALHA_PERGUNTA; }
}
