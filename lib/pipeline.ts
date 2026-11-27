/** Porte de app/pipeline.py: mesmas etapas, mesma ordem. */
import * as calc from "./calc";
import { renderizar } from "./deck";
import { checar } from "./validate";
import * as steps from "./steps";
import type { ChatJson } from "./steps";
import type { Uso } from "./bedrock";
import type { Ativo } from "./types";
import { CONFIANCA_MINIMA, classificarPorConteudo } from "./classificacao";
import { MAX_TRANSCRICAO_CHARS, juntarTranscricoes, transcricaoJunta, aplicarAjustes, eDerivada, hashTexto, limparNome, NOME_FONTE_DERIVADA, removerDerivada, type Caso } from "./caso";

export { MAX_TRANSCRICAO_CHARS, juntarTranscricoes };

/** Progresso de uma etapa longa: `etapa` é o código da fase, `pct` vai de 0 a 100. */
export type Progress = (etapa: string, pct: number, msg: string) => void;

/** O que o card do deck mostra. `arquivos` mapeia o formato ao nome (ou, depois de gravado, ao link de download). */
export interface Resultado {
  arquivos: Record<string, string>;
  avisos: string[];
  pendencias: string[];
  resumo: { lead: string; total: number; perfil: string };
  tokens: { chamadas: number; entrada: number; saida: number };
}

const chave = (nome: string) => nome.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ativos de várias fontes: a carteira é a união. O mesmo nome em fontes diferentes é somado (fica nos dois) e vira pendência. */
export function unirCarteiras(fontes: { nome: string; ativos: Ativo[]; data_posicao: string }[]): { ativos: Ativo[]; data_posicao: string; pendencias: string[] } {
  const ativos = fontes.flatMap((f) => f.ativos);
  const pendencias: string[] = [];
  const porChave = new Map<string, Map<string, string>>(); // chave -> fonte -> nome original
  for (const f of fontes) for (const a of f.ativos) {
    const k = chave(a.nome);
    if (!k) continue;
    if (!porChave.has(k)) porChave.set(k, new Map());
    if (!porChave.get(k)!.has(f.nome)) porChave.get(k)!.set(f.nome, a.nome);
  }
  for (const m of porChave.values()) {
    if (m.size < 2) continue;
    const [primeira] = m.values();
    pendencias.push(`Possível duplicidade entre ${[...m.keys()].join(" e ")}: "${primeira}". Os valores foram somados, confira.`);
  }
  return { ativos, data_posicao: dataMaisRecente(fontes.map((f) => f.data_posicao)), pendencias };
}

function paraData(s: string): number | null {
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const br = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) return Date.UTC(+br[3] < 100 ? 2000 + +br[3] : +br[3], +br[2] - 1, +br[1]);
  return null;
}

/** Fica com a mais recente; o que não for data reconhecível só vale se nenhuma outra existir. */
export function dataMaisRecente(datas: string[]): string {
  let melhor = "", ts = -Infinity;
  for (const d of datas) { const t = paraData(d); if (t !== null && t > ts) { ts = t; melhor = d; } }
  return melhor || datas.find((d) => d) || "";
}

export interface Anexo { nome: string; buf: Buffer; texto?: string }

const semAcento = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");

/** _slug do Python: title() e só [A-Za-z0-9]. Aqui sem perder letras acentuadas. */
export function slug(s: string): string {
  const t = semAcento(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
  return t.replace(/[^A-Za-z0-9]+/g, "") || "Lead";
}


/** Rede de segurança: a leitura achou o conteúdo de um papel no arquivo do outro. */
export function avisosDePapel(carts: { nome: string; texto: string; origemPapel: string; tipo?: string }[], trs: { nome: string; texto: string; origemPapel: string; tipo?: string }[]): string[] {
  const out: string[] = [];
  // Arquivo que a triagem por LLM já identificou (tipo preenchido) não passa pela contagem de sinais.
  const confiavel = (f: { origemPapel: string; tipo?: string }) => !f.tipo && !["usuario", "declarado", "transcricao"].includes(f.origemPapel);
  for (const f of carts.filter(confiavel)) {
    const c = classificarPorConteudo(f.texto);
    if (c.papel === "transcricao" && c.confianca >= CONFIANCA_MINIMA)
      out.push(`"${f.nome}" está como carteira, mas parece uma transcrição de conversa. Os valores podem ser falas, não posições. Confira o arquivo.`);
  }
  for (const f of trs.filter(confiavel)) {
    const c = classificarPorConteudo(f.texto);
    if (c.papel === "carteira" && c.confianca >= CONFIANCA_MINIMA)
      out.push(`"${f.nome}" está como transcrição, mas parece um extrato de investimentos. Confira o arquivo.`);
  }
  return out;
}

/** Leitura: extrai ativos de cada carteira e o lead da transcrição; calcula a análise. Só refaz o que mudou. */
export async function leitura(caso: Caso, chat: ChatJson, p: Progress): Promise<void> {
  const carts = caso.fontes.filter((f) => f.papel === "carteira");
  const trs = caso.fontes.filter((f) => f.papel === "transcricao")
    .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
  const pendentes = carts.filter((f) => !f.ativos);
  const jt = trs.length ? juntarTranscricoes(trs) : null;
  const ctxs = caso.fontes.filter((f) => f.papel === "contexto");
  // Sem contexto o hash é o da transcrição, como antes; com contexto, mudar o contexto refaz o lead.
  const hashTr = jt ? hashTexto(jt.texto + ctxs.map((f) => "\n#" + f.hash).join("")) : undefined;
  const refazLead = !!jt && hashTr !== caso.leadHash;
  const sig = carts.map((f) => f.hash).join("|");
  const refazCarteira = sig !== (caso.carteiraSig ?? "");
  if (!pendentes.length && !refazLead && !refazCarteira) return;

  p("carteira", 10, "Identificando ativos da carteira e lendo a transcrição da R1");
  const [saidas, lead] = await Promise.all([
    Promise.all(pendentes.map((f) => steps.extrairAtivos(f.texto, chat))),
    refazLead ? steps.extrairLead(jt!.texto, chat, ctxs.map((f) => ({ nome: f.nome, tipo: f.tipo ?? "contexto", texto: f.texto })), MAX_TRANSCRICAO_CHARS) : Promise.resolve(undefined)]);
  pendentes.forEach((f, i) => { f.ativos = saidas[i].ativos; f.dataPosicao = saidas[i].data_posicao; });
  if (lead) { lead.primeiro_nome = limparNome(lead.primeiro_nome); caso.lead = aplicarAjustes(lead, caso.ajustesLead); caso.leadHash = hashTr; }
  caso.carteiraSig = sig;

  const uniao = unirCarteiras(carts.map((f) => ({ nome: f.nome, ativos: f.ativos ?? [], data_posicao: f.dataPosicao ?? "" })));
  caso.ativos = uniao.ativos; caso.dataPosicao = uniao.data_posicao; caso.pendenciasCarteira = uniao.pendencias;
  if (carts.some(eDerivada)) caso.pendenciasCarteira.unshift("Carteira montada com valores que o lead citou na R1 (aproximados). Confirme o extrato antes da R2.");
  caso.analise = caso.ativos.length ? calc.analisar(caso.ativos) : undefined;
  caso.avisosLeitura = [
    ...avisosDePapel(carts, trs),
    ...caso.ativos.filter((a) => !(a.valor > 0)).map((a) => `"${a.nome}" veio sem valor na carteira e não entra no total. Confira o arquivo.`),
    ...carts.filter((f) => f.ativos && !f.ativos.length).map((f) => `Não encontrei ativos em "${f.nome}".`),
    ...(caso.analise && caso.analise.total <= 0 ? ["O total da carteira ficou zerado. Confira o arquivo."] : []),
    ...(jt?.aviso ? [jt.aviso] : []),
  ];
  caso.rascunho = undefined; // o rascunho depende de lead e carteira
  p("leitura", 100, "Leitura concluída");
}

/** Monta a carteira com o que o lead disse na R1. Devolve os ativos usados; lista vazia se a fala não traz valores. */
export async function derivarCarteira(caso: Caso, chat: ChatJson, p: Progress): Promise<Ativo[]> {
  const trs = caso.fontes.filter((f) => f.papel === "transcricao").sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
  if (!trs.length) return [];
  const jt = juntarTranscricoes(trs);
  p("carteira", 10, "Lendo os valores citados na R1");
  const saida = await steps.extrairAtivosDaTranscricao(jt.texto, chat);
  const ativos = saida.ativos.filter((a) => a.valor > 0);
  if (!ativos.length) return [];
  removerDerivada(caso);
  caso.fontes.push({ nome: NOME_FONTE_DERIVADA, papel: "carteira", origemPapel: "transcricao", texto: jt.texto,
    hash: hashTexto("derivada:" + hashTexto(jt.texto)), ativos, dataPosicao: "" });
  await leitura(caso, chat, p);
  return ativos;
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
const yyyymmdd = (s: string) => s.replace(/-/g, "");

/** Rascunho: alocação, diagnóstico, decisão e roteiro das notas, mais a conferência das regras do método. */
export async function rascunho(caso: Caso, chat: ChatJson, p: Progress, pct0 = 0, pct1 = 85): Promise<void> {
  const lead = caso.lead, an = caso.analise;
  if (!lead || !an) throw new Error("Faltam a carteira e os dados do lead para montar o rascunho.");
  const jt = transcricaoJunta(caso);
  const dataR2 = caso.dataR2 ?? ymd(new Date());
  const f = (x: number) => Math.round(pct0 + (pct1 - pct0) * x);

  p("alocacao", f(0.2), "Montando o De → Para");
  const aloc = await steps.proporAlocacao(lead, an, chat);
  p("diagnostico", f(0.45), "Escrevendo diagnóstico e riscos");
  const diag = await steps.diagnosticar(lead, an, aloc, chat);
  p("roteiro", f(0.7), "Escrevendo decisão e roteiro das notas");
  const [dec, notas] = await steps.fechar(lead, an, aloc, diag, { data_r2: dataR2 }, chat);
  p("validacao", f(0.9), "Conferindo regras do método");
  const [avisos, pendChecagem] = checar(lead, caso.ativos, an, aloc, diag, dec, notas, jt.texto);
  if ("aviso" in jt && jt.aviso) avisos.push({ tipo: "leitura", texto: jt.aviso, motivo: "as transcrições juntas passam do limite de tamanho" });
  caso.rascunho = { aloc, diag, dec, notas, avisos, pendencias: [...pendChecagem, ...caso.pendenciasCarteira], dataR2 };
}

/** O deck renderizado: os bytes de cada formato e o resumo para o card. Quem chama grava os bytes (R2). */
export interface DeckGerado { nome: string; binarios: Partial<Record<"pptx" | "pdf", ArrayBuffer>>; resultado: Resultado }

/** Deck: só renderiza o rascunho no deck-service. Nenhuma chamada ao LLM. `injetado` é o env quando não há contexto do Worker. */
export async function deck(
  caso: Caso, formatos: ("pptx" | "pdf")[], uso: Uso, p: Progress, pct0 = 88, injetado?: CloudflareEnv,
): Promise<DeckGerado> {
  const lead = caso.lead, an = caso.analise, r = caso.rascunho;
  if (!lead || !an || !r) throw new Error("O rascunho ainda não existe.");
  p("deck", pct0, "Montando o deck");
  const nome = `${slug(lead.primeiro_nome)}_R2_${yyyymmdd(r.dataR2)}_${slug(caso.assessor || "Assessor")}`;
  const payload = { lead, ativos: caso.ativos, an, aloc: r.aloc, diag: r.diag, dec: r.dec, notas: r.notas, data_r2: r.dataR2,
    data_posicao: caso.dataPosicao, pendencias: r.pendencias, nome_arquivo: nome };
  const binarios: DeckGerado["binarios"] = {};
  const arquivos: Record<string, string> = {};
  await Promise.all(formatos.map(async (f) => {
    binarios[f] = await renderizar(payload, f, injetado);
    arquivos[f] = `${nome}.${f}`;
  }));
  p("fim", 100, "Pronto");
  return {
    nome, binarios,
    resultado: { arquivos, avisos: r.avisos.map((a) => a.texto), pendencias: r.pendencias, resumo: { lead: lead.primeiro_nome, total: an.total, perfil: lead.perfil }, tokens: { ...uso } },
  };
}
