/** Porte 1:1 de app/calc.py. O LLM nunca faz conta. */
import { CLASSES, MODELO } from "./schemas";
import { commaFixed, pyFixed, pyRound, groupThousands } from "./pyfmt";
import type { Analise, Ativo } from "./types";

export const FGC_LIMITE = 250_000.0;

export function brl(v: number, cents = false): string {
  const s = commaFixed(v, cents ? 2 : 0);
  return "R$ " + s.replace(/,/g, "X").replace(/\./g, ",").replace(/X/g, ".");
}

export function mil(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `R$ ${pyFixed(a / 1e6, 1)} mi`.replace(".", ",");
  if (a >= 1000) return `R$ ${groupThousands(String(pyRound(a / 1000)))} mil`.replace(/,/g, ".");
  return brl(a);
}

export function pct(v: number, d = 0): string {
  return pyFixed(v, d).replace(".", ",") + "%";
}

export function analisar(ativos: Ativo[]): Analise {
  const est = ativos.filter((a) => !a.fora_do_depara);
  const fora = ativos.filter((a) => a.fora_do_depara);
  const total = Math.round(est.reduce((s, a) => s + a.valor, 0) * 100) / 100;
  const por_classe: Record<string, number> = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  for (const a of est) por_classe[a.classe] += a.valor;
  const pct_classe: Record<string, number> = Object.fromEntries(
    Object.entries(por_classe).map(([c, v]) => [c, total ? (v / total) * 100 : 0.0]));
  const sub = new Map<string, number>();
  for (const a of est) if (a.subclasse !== "n/a") sub.set(a.subclasse, (sub.get(a.subclasse) ?? 0) + a.valor);

  const emissores = new Map<string, number>();
  let semEmissor = 0;
  for (const a of est) {
    if (a.subclasse === "Bancário com FGC") {
      const k = a.emissor.trim().toLowerCase();
      if (a.emissor.trim()) emissores.set(k, (emissores.get(k) ?? 0) + a.valor);
      else semEmissor += a.valor;
    }
  }
  const vals = [...emissores.values()];
  const excConf = vals.reduce((s, v) => s + Math.max(0, v - FGC_LIMITE), 0);
  const basePior = vals.reduce((s, v) => s + v, 0) + semEmissor;
  const excPior = semEmissor ? Math.max(excConf, Math.max(0, basePior - FGC_LIMITE)) : excConf;
  const internacional = pct_classe["RF Internacional"] + pct_classe["RV Internacional"];
  let maior: Ativo | null = null;
  for (const a of est) if (!maior || a.valor > maior.valor) maior = a;
  return {
    total, por_classe, pct_classe, subclasses: Object.fromEntries(sub),
    excedente_fgc: Math.round(excPior * 100) / 100,
    excedente_fgc_a_validar: semEmissor > 0 || emissores.size <= 1,
    pct_internacional: internacional, pct_local: 100 - internacional,
    maior_ativo: maior && total ? [maior.nome, (maior.valor / total) * 100] : null,
    n_ativos: est.length,
    n_classes: Object.values(por_classe).filter((v) => v > 0).length,
    fora_do_estudo: fora.map((a) => [a.nome, a.valor]),
  };
}

/** Arredonda para inteiros somando exatamente 100 (maior resto). */
export function normalizarAlvo(pcts: Record<string, number>): Record<string, number> {
  const s = Object.values(pcts).reduce((a, b) => a + b, 0) || 1;
  const raw: Record<string, number> = {};
  const base: Record<string, number> = {};
  for (const [k, v] of Object.entries(pcts)) { raw[k] = (v / s) * 100; base[k] = Math.trunc(raw[k]); }
  const falta = 100 - Object.values(base).reduce((a, b) => a + b, 0);
  // sort estável, decrescente pelo resto (igual ao sorted(..., reverse=True) do Python, que preserva a ordem original nos empates)
  const ordem = Object.keys(raw).map((k, i) => ({ k, i, r: raw[k] - base[k] }))
    .sort((a, b) => (b.r - a.r) || (a.i - b.i));
  for (const { k } of ordem.slice(0, Math.max(falta, 0))) base[k] += 1;
  return base;
}

export function modeloDoPerfil(perfil: string): Record<string, number> {
  const m = MODELO[perfil] ?? MODELO["Conservador"];
  return Object.fromEntries(CLASSES.map((c, i) => [c, m[i]]));
}

// perfil não entra nos fatos (igual ao Python); o parâmetro existe só por paridade de assinatura
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function fatosParaPrompt(an: Analise, _perfil?: string): string[] {
  const f = [`Patrimônio financeiro do estudo: ${brl(an.total, true)}`];
  for (const [c, v] of Object.entries(an.por_classe))
    if (v > 0) f.push(`Hoje em ${c}: ${brl(v)} (${pct(an.pct_classe[c], 1)})`);
  for (const c of CLASSES) if (an.por_classe[c] === 0) f.push(`Hoje em ${c}: 0%`);
  for (const [s, v] of Object.entries(an.subclasses)) f.push(`Subclasse ${s}: ${brl(v)}`);
  f.push(`Internacional hoje: ${pct(an.pct_internacional, 1)}; local: ${pct(an.pct_local, 1)}`);
  if (an.excedente_fgc > 0) {
    const extra = an.excedente_fgc_a_validar ? " (a validar: depende de os papéis serem do mesmo conglomerado)" : "";
    f.push(`Acima do limite do FGC de ${brl(FGC_LIMITE)}: ${brl(an.excedente_fgc)}${extra}`);
  }
  if (an.maior_ativo) f.push(`Maior ativo: ${an.maior_ativo[0]} com ${pct(an.maior_ativo[1], 1)}`);
  for (const [n, v] of an.fora_do_estudo) f.push(`Fora do estudo (não se move): ${n} ${brl(v)}`);
  return f;
}
