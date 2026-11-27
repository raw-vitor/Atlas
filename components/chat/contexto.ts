import type { Contexto, Faixa } from "./types";

export const FAIXAS: Faixa[] = [60, 85, 95];

/** Porcentagem inteira (arredondada para baixo, para a faixa e o número concordarem), entre 0 e 100. */
export function pctDe(tokens: number, limite: number): number {
  if (!(limite > 0) || !(tokens > 0)) return 0;
  return Math.min(100, Math.floor((tokens / limite) * 100));
}

/** Maior faixa de alerta já atingida, ou null abaixo de 60%. */
export function faixaDe(pct: number): Faixa | null {
  for (let i = FAIXAS.length - 1; i >= 0; i--) if (pct >= FAIXAS[i]) return FAIXAS[i];
  return null;
}

/** Faixa cujo alerta deve aparecer: a atual, se ainda não foi vista nesta conversa. */
export function alertaPendente(pct: number, vistos: readonly Faixa[]): Faixa | null {
  const f = faixaDe(pct);
  return f && !vistos.includes(f) ? f : null;
}

/** Nível de cor do anel. Só as cores da marca, a urgência sobe escurecendo o verde. */
export type NivelContexto = "ok" | "atencao" | "alerta" | "critico";
export function nivelDe(pct: number): NivelContexto {
  if (pct >= 95) return "critico";
  if (pct >= 85) return "alerta";
  if (pct >= 60) return "atencao";
  return "ok";
}

const dec = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** 850 → "850"; 76 000 → "76 mil"; 1 500 → "1,5 mil"; 1 000 000 → "1 milhão"; 2 500 000 → "2,5 milhões". */
export function formatarTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const mil = v / 1000;
    const txt = mil < 10 ? Math.round(mil * 10) / 10 : Math.round(mil);
    if (txt < 1000) return `${dec(txt)} mil`;
  }
  const mi = Math.round((v / 1_000_000) * 10) / 10;
  return mi === 1 ? "1 milhão" : `${dec(mi)} milhões`;
}

const ROTULO_PARTES: [keyof Contexto["partes"], string][] = [
  ["transcricao", "Transcrição"], ["carteira", "Carteira"], ["historico", "Histórico"], ["outros", "Outros"],
];

/** Linhas do tooltip: "Contexto: 38% (76 mil de 200 mil tokens)", as partes e a marca de estimado. */
export function descreverContexto(tokens: number, limite: number, estimado = false, partes?: Contexto["partes"]): string[] {
  const pct = pctDe(tokens, limite);
  const linhas = [`Contexto: ${pct}% (${formatarTokens(tokens)} de ${formatarTokens(limite)} tokens)`];
  if (partes) {
    const p = ROTULO_PARTES.filter(([k]) => partes[k] > 0).map(([k, r]) => `${r} ${formatarTokens(partes[k])}`);
    if (p.length) linhas.push(p.join(" · "));
  }
  if (estimado) linhas.push("Valor estimado, até a primeira resposta do modelo.");
  return linhas;
}

export function textoAlerta(faixa: Faixa, pct: number): string {
  if (faixa === 95) return `Contexto quase cheio (${pct}%). Para não perder detalhes, comece uma nova conversa.`;
  if (faixa === 85) return `A conversa está ficando longa (${pct}%). As respostas podem demorar mais.`;
  return `A conversa está ficando longa (${pct}%).`;
}
