/** Interpreta a mensagem do assessor e os anexos: quem é a carteira, quem é a transcrição, assessor e data da R2. */
import { perguntarJson, type Uso } from "./bedrock";
import { createHash } from "node:crypto";
import { toText } from "./ingest";
import { EXT_OK, FORMATOS, extensaoDe } from "./formatos";
import { classificarPorConteudo, classificarPorNome, triar, type Papel, type Triagem } from "./classificacao";
import { config } from "./config";
import type { Anexo } from "./pipeline";
import { CONFIANCA_LLM_MINIMA, eSubstituivelPorExtrato, papelDe, triarComLlm, type ClassLlm, type PapelTriado, type TriadorLlm } from "./triagem-llm";

export interface Interpretado {
  carteiras: Anexo[]; transcricoes: Anexo[]; assessor: string; assessorInformado: boolean;
  dataR2: Date; dataInformada: boolean; ignorados: string[]; pergunta?: string;
  /** Arquivos cujo conteúdo contradiz o nome (ex.: "Reunião..." tratado como carteira). */
  avisos: string[];
  /** Arquivos que não são carteira nem transcrição, mas entram como contexto do lead (deck anterior, anotações). */
  contextos: Anexo[];
  /** O que o LLM entendeu de cada arquivo, por nome. Vazio se a triagem por LLM não decidiu. */
  detalhes: Record<string, { tipo: ClassLlm["tipo"]; contem: ClassLlm["contem"]; data: string; papel: PapelTriado }>;
}

/** Texto da mensagem com este tamanho ou mais vira fonte se o conteúdo decidir ("texto da mensagem"). */
export const MIN_TEXTO_FONTE = 300;
/** Abaixo disso, só vira fonte com sinal forte: 2+ valores em R$ (carteira) ou 3+ falas (transcrição). */
const sinal = (sinais: readonly string[], k: string) => Number(sinais.find((x) => x.startsWith(k + ":"))?.split(":")[1] ?? 0);
export const MAX_TEXTO_FONTE = 20_000;
export const NOME_TEXTO_MSG = "texto da mensagem";

export function extrairAssessor(msg: string): string | null {
  const m = msg.match(/assessor(?:a)?\s*(?:[:=\-]|é|e|:)?\s*([\p{Lu}][\p{L}'-]+(?:[ \t]+(?:d[aeo]s?[ \t]+)?[\p{Lu}][\p{L}'-]+)?)/u);
  return m ? m[1].trim() : null;
}

export function extrairData(msg: string, hoje = new Date()): Date | null {
  const m = msg.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
  if (ano < 100) ano += 2000;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : null;
}

const hojeUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nomePapel = (p: PapelTriado) => (p === "carteira" ? "carteira" : p === "contexto" ? "contexto" : "transcrição");

/** "o extrato.pdf é a carteira" na mensagem vira papel declarado para esse arquivo. */
export function papeisDaMensagem(msg: string, nomes: string[]): Record<string, Papel> {
  const out: Record<string, Papel> = {};
  for (const n of nomes) {
    const m = msg.match(new RegExp(`${escapar(n)}["”']?\\s*(?:é|e|eh|=|:)\\s*(?:a\\s+|uma\\s+|o\\s+)?(carteira|transcri[cç][aã]o)`, "i"));
    if (m) out[n] = /^carteira/i.test(m[1]) ? "carteira" : "transcricao";
  }
  return out;
}

export async function interpretar(
  msg: string, files: { nome: string; buf: Buffer }[], uso: Uso, declarados: Record<string, Papel> = {}, triador: TriadorLlm = triarComLlm,
): Promise<Interpretado> {
  const assessor = extrairAssessor(msg);
  const data = extrairData(msg);
  const base: Interpretado = {
    assessor: assessor ?? "Assessor", assessorInformado: !!assessor,
    dataR2: data ?? hojeUTC(), dataInformada: !!data, ignorados: [], carteiras: [], transcricoes: [], avisos: [], contextos: [], detalhes: {},
  };
  const textoMsg = msg.trim();
  if (textoMsg.length > MAX_TEXTO_FONTE) throw new Error(`O texto da mensagem passa de ${MAX_TEXTO_FONTE} caracteres. Envie como arquivo.`);
  const triMsg = textoMsg ? triar({ nome: NOME_TEXTO_MSG, texto: textoMsg, palpiteDaExtensao: "transcricao" }) : null;
  const comoFonte = !!triMsg && triMsg.origem === "conteudo" && (textoMsg.length >= MIN_TEXTO_FONTE ||
    (triMsg.papel === "carteira" ? sinal(triMsg.sinais, "valores") >= 2 : sinal(triMsg.sinais, "falas") >= 3 || triMsg.sinais.includes("cue_de_legenda")));
  if (!files.length && !comoFonte) {
    const saudacao = /^\s*(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|hey|hello|hi)\b[\s!?.,]*$/i.test(textoMsg);
    const anotado = [assessor && `assessor ${assessor}`, data && `data da R2 ${data.toISOString().slice(0, 10).split("-").reverse().join("/")}`].filter(Boolean).join(" e ");
    const abertura = saudacao || !textoMsg ? "Olá! Sou o Atlas e monto o deck da R2 a partir da carteira e da transcrição da R1."
      : anotado ? `Anotei: ${anotado}.` : "Entendi.";
    return { ...base, pergunta: `${abertura} Para começar, envie a carteira do lead e a transcrição da R1. Pode anexar arquivos (planilha, PDF, foto, docx, odt, vtt, txt) ou digitar/colar o texto aqui no chat.` };
  }
  for (const f of files) {
    const ext = extensaoDe(f.nome);
    if (!EXT_OK.includes(ext)) throw new Error(`Formato não suportado em "${f.nome}": ${ext || "sem extensão"}.`);
    if (f.buf.length > config.maxUploadMb * 1024 * 1024) throw new Error(`"${f.nome}" passa de ${config.maxUploadMb} MB.`);
  }
  const decl = { ...papeisDaMensagem(msg, files.map((f) => f.nome)), ...declarados };

  // Cópias no mesmo lote (mesmo sha256) ficam de fora. Um arquivo ilegível não derruba o envio.
  const anexos: Anexo[] = [];
  const vistos = new Map<string, string>();
  for (const f of files) {
    const hash = createHash("sha256").update(f.buf).digest("hex");
    const original = vistos.get(hash);
    if (original) { base.ignorados.push(`${f.nome} (cópia de ${original})`); continue; }
    vistos.set(hash, f.nome);
    try { anexos.push({ ...f, texto: await toText(f.nome, f.buf, uso) }); }
    catch (e) { base.ignorados.push(`${f.nome} (${e instanceof Error ? e.message : "não consegui ler"})`); }
  }

  // Escada: papel declarado > conteúdo > nome > extensão.
  const tri = new Map<Anexo, Triagem>();
  for (const a of anexos) {
    const d = decl[a.nome];
    if (d) { tri.set(a, { papel: d, origem: "usuario", confianca: 1, sinais: ["declarado"], incerto: false }); continue; }
    const p = FORMATOS[extensaoDe(a.nome)].palpite;
    const palpite: Papel = p === "ambos" ? classificarPorConteudo(a.texto!).papel : p;
    tri.set(a, triar({ nome: a.nome, texto: a.texto!, palpiteDaExtensao: palpite }));
  }
  // O texto da mensagem só vira fonte se o conteúdo decidir. Fora disso fica só como instrução.
  if (comoFonte) {
    const a: Anexo = { nome: NOME_TEXTO_MSG, buf: Buffer.from(textoMsg), texto: textoMsg };
    anexos.push(a); tri.set(a, triMsg!);
  }

  // Triagem por LLM de tudo o que o assessor não declarou: o que cada arquivo é e o que dá para tirar dele.
  // Só vale com confiança alta; sem LLM (ou com erro) fica a contagem de sinais acima.
  const papelFinal = new Map<Anexo, PapelTriado>(anexos.map((a) => [a, tri.get(a)!.papel]));
  const decididos = new Set<Anexo>();
  const tipoDe = new Map<Anexo, ClassLlm>();
  const paraLlm = anexos.filter((a) => tri.get(a)!.origem !== "usuario");
  if (paraLlm.length) {
    const rs = await triador(paraLlm.map((a) => ({ nome: a.nome, texto: a.texto!, dica: `${tri.get(a)!.papel} (${tri.get(a)!.sinais.join(", ") || "sem sinais"})` })), uso);
    paraLlm.forEach((a, i) => {
      const c = rs?.[i];
      if (!c || c.confianca < CONFIANCA_LLM_MINIMA) return;
      const antes = tri.get(a)!;
      const papel = papelDe(c);
      decididos.add(a); tipoDe.set(a, c); papelFinal.set(a, papel);
      if (papel !== "contexto") {
        if (papel !== antes.papel)
          base.avisos.push(`li "${a.nome}" como ${papel === "carteira" ? "carteira" : "transcrição"} (${c.motivo || "pelo conteúdo"}), mas a contagem de sinais indicava ${nomePapel(antes.papel)}.`);
        tri.set(a, { ...antes, papel, confianca: c.confianca, sinais: [...antes.sinais, "llm"], incerto: false });
      }
    });
    // Com extrato no lote, a posição de deck anterior ou anotações é só contexto: somar as duas dobraria a carteira.
    if ([...tipoDe.values()].some((c) => c.tipo === "extrato"))
      for (const [a, c] of tipoDe) if (papelFinal.get(a) === "carteira" && eSubstituivelPorExtrato(c.tipo)) papelFinal.set(a, "contexto");
  }

  // Desempate antigo (primeiros 1.500 caracteres) para quem a triagem não decidiu.
  const incertos = anexos.filter((a) => tri.get(a)!.incerto && !decididos.has(a));
  if (incertos.length) {
    try {
      const r = await perguntarJson(
        "Você classifica anexos de um assessor de investimentos. 'carteira' é a posição/extrato de investimentos (tabela de ativos e valores). 'transcricao' é a transcrição de uma reunião (diálogo).",
        incertos.map((a, i) => `ARQUIVO ${i} (${a.nome}):\n${a.texto!.slice(0, 1500)}`).join("\n\n---\n\n"),
        { type: "object", properties: { classificacoes: { type: "array", items: { type: "object",
          properties: { indice: { type: "integer" }, papel: { type: "string", enum: ["carteira", "transcricao"] } },
          required: ["indice", "papel"], additionalProperties: false } } },
          required: ["classificacoes"], additionalProperties: false }, uso) as { classificacoes: { indice: number; papel: Papel }[] };
      for (const c of r.classificacoes) {
        const a = incertos[c.indice];
        if (a && (c.papel === "carteira" || c.papel === "transcricao")) {
          tri.set(a, { ...tri.get(a)!, papel: c.papel, incerto: false, sinais: [...tri.get(a)!.sinais, "llm"] });
          papelFinal.set(a, c.papel);
        }
      }
    } catch { /* mantém o palpite da extensão */ }
  }

  const doPapel = (p: PapelTriado) => anexos.filter((a) => papelFinal.get(a) === p);
  base.carteiras = doPapel("carteira");
  base.transcricoes = doPapel("transcricao").sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
  base.contextos = doPapel("contexto");
  for (const [a, c] of tipoDe) base.detalhes[a.nome] = { tipo: c.tipo, contem: c.contem, data: c.data_referencia, papel: papelFinal.get(a)! };

  // Conteúdo contra nome: o assessor precisa saber, porque é a troca silenciosa que gerou o deck errado.
  for (const a of [...base.carteiras, ...base.transcricoes]) {
    const t = tri.get(a)!;
    if (t.origem === "usuario" || a.nome === NOME_TEXTO_MSG) continue;
    const doNome = classificarPorNome(a.nome);
    if (doNome && doNome.papel !== t.papel)
      base.avisos.push(`tratei "${a.nome}" como ${nomePapel(t.papel)}, mas o nome indica ${nomePapel(doNome.papel)}. Se estiver errado, diga: "${a.nome} é a ${nomePapel(doNome.papel)}".`);
  }

  const falta = [!base.carteiras.length && "a carteira", !base.transcricoes.length && "a transcrição da R1"].filter(Boolean);
  if (falta.length) {
    const entendi = anexos.length
      ? ` Entendi assim: ${anexos.map((a) => `${a.nome} = ${nomePapel(papelFinal.get(a)!)}`).join("; ")}. Se algum estiver errado, diga, por exemplo: "${anexos[0].nome} é a ${papelFinal.get(anexos[0]) === "carteira" ? "transcrição" : "carteira"}".`
      : "";
    const naoUsei = base.ignorados.length ? ` Não usei: ${base.ignorados.join("; ")}.` : "";
    return { ...base, pergunta: `Falta ${falta.join(" e ")}.${entendi}${naoUsei}` };
  }
  return base;
}
