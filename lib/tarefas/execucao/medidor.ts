/**
 * Medidor da janela de contexto (decisões D4 e D5 do plano). Funções puras.
 *
 * O valor é o maior `usage.inputTokens` que o Bedrock devolveu numa chamada do turno (`Uso.maiorEntrada`). Se o turno não fez
 * nenhuma chamada que carregue o caso (mensagem não reconhecida, só um ajuste de nome ou perfil), esse número não diz nada sobre o
 * tamanho da conversa: nesse caso o valor é estimado em caracteres ÷ 3,5 sobre o que o prompt de uma pergunta levaria, e marcado
 * como `estimado`. As partes dividem o valor pela proporção de caracteres de cada bloco.
 */
import { MAX_TRANSCRICAO_CHARS, eDerivada, transcricaoJunta, type Caso } from "../../caso";
import type { Contexto } from "../../db/tipos";

export const CHARS_POR_TOKEN = 3.5;
/** Instruções fixas de cada prompt (papel, regras, formato) e o método (base de conhecimento) que entra nas chamadas de leitura. */
const CHARS_FIXOS = 3_000;
/** Os mesmos limites de `lib/conversa.ts` para o histórico que vai ao prompt. */
const MAX_HISTORICO_PROMPT = 10;
const MAX_MSG_HISTORICO = 1_500;
/** Uma chamada que carrega menos que esta fração do que o caso pesa não mede o contexto da conversa. */
const FRACAO_MINIMA = 0.5;

export type PartesChars = Contexto["partes"];

/** Caracteres de cada bloco do prompt que o caso produz. Usa o texto das fontes que estiver carregado (as demais contam como vazias). */
export function caracteresDoPrompt(caso: Caso): PartesChars {
  const transcricao = Math.min(transcricaoJunta(caso).texto.length, MAX_TRANSCRICAO_CHARS);
  // Carteira já lida pesa como a lista de ativos no prompt; a que ainda não foi lida, como o texto do arquivo (extração em blocos).
  const lidas = caso.ativos.reduce((t, a) => t + a.nome.length + a.classe.length + 32, 0) + (caso.analise ? 800 : 0);
  const pendentes = caso.fontes.filter((f) => f.papel === "carteira" && !eDerivada(f) && !f.ativos).reduce((t, f) => t + f.texto.length, 0);
  const historico = caso.historico.slice(-MAX_HISTORICO_PROMPT).reduce((t, m) => t + Math.min(m.texto.length, MAX_MSG_HISTORICO) + 12, 0);
  const contextos = caso.fontes.filter((f) => f.papel === "contexto").reduce((t, f) => t + f.texto.length, 0);
  const lead = caso.lead ? JSON.stringify(caso.lead).length : 0;
  const rascunho = caso.rascunho ? JSON.stringify({ a: caso.rascunho.aloc, d: caso.rascunho.diag, c: caso.rascunho.dec }).length : 0;
  const avisos = [...caso.avisosLeitura, ...caso.pendenciasCarteira, ...(caso.rascunho?.pendencias ?? [])].reduce((t, a) => t + a.length + 3, 0);
  return { transcricao, carteira: lidas + pendentes, historico, outros: CHARS_FIXOS + contextos + lead + rascunho + avisos };
}

/** Reparte `total` entre as partes na proporção de `chars`, em inteiros que somam exatamente `total` (maior resto). */
export function repartir(total: number, chars: PartesChars): PartesChars {
  const chaves = Object.keys(chars) as (keyof PartesChars)[];
  const soma = chaves.reduce((t, k) => t + chars[k], 0);
  const saida: PartesChars = { transcricao: 0, carteira: 0, historico: 0, outros: 0 };
  if (total <= 0 || soma <= 0) return saida;
  const restos: [keyof PartesChars, number][] = [];
  let usado = 0;
  for (const k of chaves) {
    const exato = (chars[k] / soma) * total;
    saida[k] = Math.floor(exato);
    usado += saida[k];
    restos.push([k, exato - saida[k]]);
  }
  restos.sort((a, b) => b[1] - a[1]);
  for (let i = 0; usado < total; i = (i + 1) % restos.length, usado++) saida[restos[i][0]] += 1;
  return saida;
}

/**
 * O medidor depois de um turno. `maiorEntrada` é `uso.maiorEntrada`; `limite` vem de `limiteContexto()`.
 * Real quando o turno mediu ao menos metade do que o caso pesa; senão a estimativa, marcada como tal.
 */
export function medirContexto(caso: Caso, maiorEntrada: number, limite: number): Contexto {
  const chars = caracteresDoPrompt(caso);
  const total = chars.transcricao + chars.carteira + chars.historico + chars.outros;
  const estimativa = Math.ceil(total / CHARS_POR_TOKEN);
  const real = Number.isFinite(maiorEntrada) && maiorEntrada > 0 ? Math.floor(maiorEntrada) : 0;
  const usarReal = real > 0 && real >= estimativa * FRACAO_MINIMA;
  const tokens = usarReal ? real : estimativa;
  return {
    tokens, limite,
    pct: limite > 0 ? Math.floor((tokens / limite) * 1000) / 10 : 0,
    estimado: !usarReal,
    partes: repartir(tokens, chars),
  };
}
