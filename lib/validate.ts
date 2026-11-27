/** Porte 1:1 de app/validate.py: regras do método (08, 13) aplicadas em código. */
import * as calc from "./calc";
import { dumpModel } from "./schemas";
import { pyRound, commaFixed, pyFixed } from "./pyfmt";
import type { Alocacao, Analise, Ativo, Decisao, Diagnostico, Lead, Notas } from "./types";

const BANCOS = ["itaú", "itau", "bradesco", "santander", "banco do brasil", "caixa", "nubank", "inter", "btg", "xp", "safra",
  "c6", "original", "pan", "daycoval", "bmg", "master", "pine", "sofisa", "bs2", "genial", "modal", "votorantim"];
const PROMESSA = /\b(garanto|garantimos|garantido|vai render|certeza de|sem risco algum|rentabilidade de \d)/gi;
const PROIBIDO = ["faz sentido darmos continuidade"];
const VALOR = /R\$\s*([\d.,]+)\s*(mil|mi)?/gi;

export function norm(s: string): string {
  const t = s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  return t.replace(/[^a-z0-9 ]/g, "").trim();
}

export function valores(txt: string): number[] {
  const out: number[] = [];
  for (const m of txt.matchAll(VALOR)) {
    const raw = m[1].replace(/[.,]+$/, "");
    if (!raw) continue;
    const partes = raw.split(".");
    const br = raw.includes(",") || partes.length - 1 > 1 || partes[partes.length - 1].length === 3;
    const v = Number(br ? raw.replace(/\./g, "").replace(",", ".") : raw);
    if (!Number.isFinite(v)) continue;
    const mult = ({ mil: 1e3, mi: 1e6 } as Record<string, number>)[(m[2] ?? "").toLowerCase()] ?? 1;
    out.push(v * mult);
  }
  return out;
}

/** Pendências que valem para qualquer caso. O chat não as repete; o painel do deck mostra. */
export const PENDENCIAS_FIXAS = [
  "custo de não fazer nada em R$ (precisa das taxas dos ativos atuais)",
  "regras do arquivo 09 (IR, FGC, macro) são de 08/10/2026: reconfirmar por busca antes de usar",
];

/** Regras que só dependem dos dados lidos: citação na transcrição e pendências. */
export function checarDados(lead: Lead, ativos: Ativo[], an: Analise, transcricao: string): [string[], string[]] {
  const avisos: string[] = [];
  const pend: string[] = [];
  const tn = norm(transcricao);
  for (const fr of lead.frases_literais)
    if (norm(fr) && !tn.includes(norm(fr))) avisos.push(`Citação não encontrada literalmente na transcrição: "${fr.slice(0, 60)}…"`);

  if (an.excedente_fgc > 0 && an.excedente_fgc_a_validar)
    pend.push("confirmar se os papéis bancários são do mesmo conglomerado (define o excedente do FGC)");
  const semLiq = ativos.filter((a) => !a.fora_do_depara && (!a.liquidez.trim() || a.liquidez.toLowerCase().includes("confirmar"))).map((a) => a.nome);
  if (semLiq.length) pend.push("liquidez diária × portabilidade, taxa, carência e vencimento de: " + [...new Set(semLiq)].join(", "));
  pend.push(...PENDENCIAS_FIXAS);
  return [avisos, pend];
}

export function checar(lead: Lead, ativos: Ativo[], an: Analise, aloc: Alocacao, diag: Diagnostico, dec: Decisao,
  notas: Notas, transcricao: string): [string[], string[]] {
  const [avisosDados, pend] = checarDados(lead, ativos, an, transcricao);
  return [[...checarRascunho(lead, ativos, an, aloc, diag, dec, notas), ...avisosDados], pend];
}

export function checarRascunho(lead: Lead, ativos: Ativo[], an: Analise, aloc: Alocacao, diag: Diagnostico, dec: Decisao,
  notas: Notas): string[] {
  const avisos: string[] = [];

  const soma = aloc.classes.reduce((s, c) => s + c.pct_proposto, 0);
  if (Math.abs(soma - 100) > 0.5) avisos.push(`Proposta soma ${pyFixed(soma, 0)}% (esperado 100%).`);

  const emissores = new Set([...ativos.filter((a) => a.emissor.trim()).map((a) => norm(a.emissor)), ...BANCOS.map(norm)]);
  for (const c of aloc.classes) {
    const t = norm(c.para_detalhe);
    if ([...emissores].some((e) => e && ` ${t} `.includes(` ${e} `)))
      avisos.push(`'Para' de ${c.classe} cita emissor/produto: "${c.para_detalhe}".`);
  }

  const modelo = calc.modeloDoPerfil(lead.perfil);
  for (const c of aloc.classes)
    if (Math.abs(c.pct_proposto - modelo[c.classe]) > 5 && c.porque.trim().length < 8)
      avisos.push(`${c.classe} desvia mais de 5 p.p. do modelo sem motivo escrito.`);
  if (lead.perfil === "Conservador")
    for (const c of aloc.classes)
      if (["Ações Brasil", "RV Internacional", "FIIs", "Alternativos"].includes(c.classe) && c.pct_proposto > 0)
        avisos.push(`${c.classe} ${pyFixed(c.pct_proposto, 0)}% acima do risco do perfil Conservador (reavaliar suitability).`);

  const dDiag = dumpModel(diag, "Diagnostico"), dDec = dumpModel(dec, "Decisao");
  const textos = [dDiag, dDec, dumpModel(notas, "Notas"), dumpModel(aloc, "Alocacao")].join("\n");
  for (const m of textos.matchAll(PROMESSA)) avisos.push(`Possível promessa de rentabilidade: "${m[0]}".`);
  for (const p of PROIBIDO)
    if (textos.toLowerCase().includes(p)) avisos.push(`Expressão proibida pelo método: "${p}".`);

  const fatos = new Set<number>();
  for (const f of calc.fatosParaPrompt(an, lead.perfil)) for (const v of valores(f)) fatos.add(pyRound(v));
  for (const c of aloc.classes) fatos.add(pyRound((an.total * c.pct_proposto) / 100));
  for (const c of aloc.classes) fatos.add(pyRound(Math.abs((an.total * c.pct_proposto) / 100 - an.por_classe[c.classe])));
  fatos.add(pyRound(lead.aporte_mensal));
  for (const v of valores([dDiag, dDec].join(" ")))
    if (v > 1000 && ![...fatos].some((f) => Math.abs(v - f) <= Math.max(1000, f * 0.02)))
      avisos.push(`Valor R$ ${commaFixed(v, 0)} nos slides não bate com os números calculados (confira).`.replace(/,/g, "."));
  return avisos;
}
