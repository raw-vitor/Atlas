/** Interpreta, com o LLM, uma mensagem curta do assessor sobre um caso já aberto. */
import { perguntarJson, type Uso } from "./bedrock";
import { CanceladoError } from "./cancelamento";
import { prontidao, type AjustesLead, type Caso } from "./caso";

/** `pergunta`: a mensagem pede uma explicação sobre o caso; vai para `responderPergunta` se não houver pedido de mudança. */
export interface Instrucao { usarTranscricao: boolean; ajustes: AjustesLead; pergunta: boolean }

export const MAX_INSTRUCAO = 500;
const PERFIS = ["Conservador", "Moderado", "Arrojado"];

const SISTEMA =
  "Você lê a mensagem de um assessor de investimentos num chat que monta o deck da R2 a partir da carteira e da transcrição da R1. " +
  "Extraia só o que a mensagem diz de forma explícita; o que não foi dito fica vazio ou falso. Não invente e não deduza. Campos:\n" +
  "- usar_transcricao: true se o assessor pede para usar os valores/dados da transcrição da R1 no lugar da carteira (ex.: 'usa a transcrição', 'pode seguir só com o que ele falou').\n" +
  "- primeiro_nome: o primeiro nome do lead, se o assessor o informa.\n" +
  "- perfil: Conservador, Moderado ou Arrojado, se o assessor define o perfil do lead; senão vazio.\n" +
  "- objetivos: objetivos do lead que o assessor informa, em frases curtas.\n" +
  "- pergunta: true se a mensagem é uma pergunta ou pedido de explicação sobre o lead, a carteira, os slides ou os avisos " +
  "(ex.: 'por que o 10 mil não bate?', 'quanto ela tem em CDB?'). Pedido para mudar algo não é pergunta. " +
  "Numa pergunta, citar um dado não é informá-lo: 'por que o perfil é Conservador?' deixa perfil vazio.\n" +
  "Instrução sobre assessor ou data da R2 não é objetivo nem nome do lead; ignore.";

const SCHEMA = {
  type: "object",
  properties: {
    usar_transcricao: { type: "boolean" },
    primeiro_nome: { type: "string" },
    perfil: { type: "string", enum: ["", ...PERFIS] },
    objetivos: { type: "array", items: { type: "string" } },
    pergunta: { type: "boolean" },
  },
  required: ["usar_transcricao", "primeiro_nome", "perfil", "objetivos", "pergunta"], additionalProperties: false,
};

export async function interpretarInstrucao(msg: string, caso: Caso, uso: Uso): Promise<Instrucao | null> {
  const pr = prontidao(caso);
  const contexto = `Situação do caso: transcrição ${caso.fontes.some((f) => f.papel === "transcricao") ? "recebida" : "ausente"}; ` +
    `ainda falta: ${pr.faltas.join("; ") || "nada"}.`;
  try {
    const r = await perguntarJson(SISTEMA, `${contexto}\n\nMENSAGEM:\n${msg}`, SCHEMA, uso) as
      { usar_transcricao: boolean; primeiro_nome: string; perfil: string; objetivos: string[]; pergunta: boolean };
    const ajustes: AjustesLead = {};
    if (r.primeiro_nome?.trim()) ajustes.primeiro_nome = r.primeiro_nome.trim();
    if (PERFIS.includes(r.perfil)) ajustes.perfil = r.perfil;
    const objetivos = (r.objetivos ?? []).map((o) => o.trim()).filter(Boolean);
    if (objetivos.length) ajustes.objetivos = objetivos;
    return { usarTranscricao: r.usar_transcricao === true, ajustes, pergunta: r.pergunta === true };
  } catch (e) { if (e instanceof CanceladoError) throw e; return null; } // sem a interpretação, a mensagem segue o caminho normal
}
