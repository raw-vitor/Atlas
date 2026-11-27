/** Triagem de cada arquivo por LLM: o que ele é e o que dá para tirar dele. A contagem de sinais fica de reserva. */
import { perguntarJson, type Uso } from "./bedrock";
import { CanceladoError } from "./cancelamento";
import { config } from "./config";

export const TIPOS = ["extrato", "transcricao_r1", "deck_anterior", "anotacoes", "outro"] as const;
export const CONTEM = ["posicao_carteira", "falas_do_lead", "dados_do_lead", "valores_citados"] as const;
export type TipoArquivo = (typeof TIPOS)[number];
export type Contem = (typeof CONTEM)[number];

export interface ClassLlm { tipo: TipoArquivo; contem: Contem[]; data_referencia: string; confianca: number; motivo: string }
export interface ItemTriagem { nome: string; texto: string; dica: string }
export type TriadorLlm = (itens: ItemTriagem[], uso?: Uso) => Promise<(ClassLlm | null)[] | null>;

/** Abaixo disto a resposta do LLM não manda; vale a contagem de sinais. */
export const CONFIANCA_LLM_MINIMA = 0.7;
const TRECHO = 1500;

const SISTEMA =
  "Você classifica arquivos enviados por um assessor de investimentos que prepara a reunião R2 de um lead. Para cada arquivo diga:\n" +
  "- tipo: 'extrato' (posição/extrato de investimentos do lead, com ativos e valores); 'transcricao_r1' (transcrição da reunião R1, diálogo entre assessor e lead); " +
  "'deck_anterior' (apresentação ou proposta já montada para este lead); 'anotacoes' (notas soltas do assessor); 'outro'.\n" +
  "- contem: o que dá para tirar dele, entre posicao_carteira (ativos com valor), falas_do_lead (falas do próprio lead), dados_do_lead (perfil, objetivos, família, restrições), " +
  "valores_citados (valores em reais ditos numa conversa, sem ser extrato). Lista vazia se nada servir.\n" +
  "- data_referencia: data da posição ou da reunião, se aparecer; senão vazio.\n" +
  "- confianca de 0 a 1 e motivo em uma frase.\n" +
  "Uma conversa que cita CDB, liquidez ou vencimento NÃO é extrato. Valores ditos em reunião são 'valores_citados', não posição. " +
  "As 'DICAS' vêm de uma contagem automática e podem estar erradas; decida pelo conteúdo.";

const SCHEMA = {
  type: "object",
  properties: { classificacoes: { type: "array", items: { type: "object",
    properties: {
      indice: { type: "integer" },
      tipo: { type: "string", enum: [...TIPOS] },
      contem: { type: "array", items: { type: "string", enum: [...CONTEM] } },
      data_referencia: { type: "string" },
      confianca: { type: "number" },
      motivo: { type: "string" },
    },
    required: ["indice", "tipo", "contem", "data_referencia", "confianca", "motivo"], additionalProperties: false } } },
  required: ["classificacoes"], additionalProperties: false,
};

/** Começo, meio e fim: o começo de um export de reunião é cabeçalho, e o que decide costuma estar no meio. */
export function amostra(texto: string): string {
  if (texto.length <= TRECHO * 3) return texto;
  const meio = Math.floor(texto.length / 2) - TRECHO / 2;
  return `${texto.slice(0, TRECHO)}\n[...]\n${texto.slice(meio, meio + TRECHO)}\n[...]\n${texto.slice(-TRECHO)}`;
}

/** Nunca lança: sem LLM, com erro ou desligado, devolve null e quem chama usa a contagem de sinais. */
export const triarComLlm: TriadorLlm = async (itens, uso) => {
  if (!config.triagemLlm || !itens.length) return null;
  try {
    const r = await perguntarJson(SISTEMA,
      itens.map((a, i) => `ARQUIVO ${i} (${a.nome})\nDICAS: ${a.dica}\n${amostra(a.texto)}`).join("\n\n=====\n\n"),
      SCHEMA, uso, 400 + 250 * itens.length) as { classificacoes: (ClassLlm & { indice: number })[] };
    const out: (ClassLlm | null)[] = itens.map(() => null);
    for (const c of r.classificacoes ?? [])
      if (Number.isInteger(c.indice) && c.indice >= 0 && c.indice < itens.length && TIPOS.includes(c.tipo))
        out[c.indice] = { tipo: c.tipo, contem: (c.contem ?? []).filter((x) => CONTEM.includes(x)), data_referencia: c.data_referencia ?? "", confianca: Number(c.confianca) || 0, motivo: c.motivo ?? "" };
    return out;
  } catch (e) { if (e instanceof CanceladoError) throw e; return null; }
};

export type PapelTriado = "carteira" | "transcricao" | "contexto";

/** Papel que o arquivo cumpre no caso. Quem não é extrato nem transcrição só vira carteira se for a única fonte de posição. */
export function papelDe(c: ClassLlm): PapelTriado {
  if (c.tipo === "extrato") return "carteira";
  if (c.tipo === "transcricao_r1") return "transcricao";
  if (c.contem.includes("falas_do_lead")) return "transcricao";
  if (c.contem.includes("posicao_carteira")) return "carteira";
  return "contexto";
}

/** Tipos que podem ser substituídos por um extrato de verdade. */
export const eSubstituivelPorExtrato = (tipo?: string) => tipo === "deck_anterior" || tipo === "anotacoes" || tipo === "outro";

export const ROTULO_TIPO: Record<TipoArquivo, string> = {
  extrato: "extrato", transcricao_r1: "transcrição da R1", deck_anterior: "deck anterior", anotacoes: "anotações", outro: "outro documento",
};
