/** Regras do método (08, 13) aplicadas em código. Começou como porte 1:1 de app/validate.py; hoje diverge de propósito:
 *  avisos estruturados, valor deduplicado com campo e trecho, valores ditos pelo lead aceitos e norm() com espaços. */
import * as calc from "./calc";
import { dumpModel } from "./schemas";
import { pyRound, commaFixed, pyFixed } from "./pyfmt";
import { numerosCitados } from "./citados";
import type { Alocacao, Analise, Ativo, Aviso, Decisao, Diagnostico, Lead, Notas } from "./types";

const BANCOS = ["itaú", "itau", "bradesco", "santander", "banco do brasil", "caixa", "nubank", "inter", "btg", "xp", "safra",
  "c6", "original", "pan", "daycoval", "bmg", "master", "pine", "sofisa", "bs2", "genial", "modal", "votorantim"];
const PROMESSA = /\b(garanto|garantimos|garantido|vai render|certeza de|sem risco algum|rentabilidade de \d)/gi;
const PROIBIDO = ["faz sentido darmos continuidade"];
// "mil" e "mi" só como palavra inteira: "R$ 1,2 milhão" é 1,2 milhão, não 1.200.
const VALOR = /R\$\s*([\d.,]+)(?:\s*(milh(?:ão|ões|ao|oes)|mil|mi)(?![\p{L}]))?/giu;

export function norm(s: string): string {
  const t = s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  return t.replace(/[^a-z0-9]+/g, " ").trim();
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
    const u = (m[2] ?? "").toLowerCase();
    const mult = u === "mil" ? 1e3 : u ? 1e6 : 1;
    out.push(v * mult);
  }
  return out;
}

/** Pendências que valem para qualquer caso. O chat não as repete; o painel do deck mostra. */
export const PENDENCIAS_FIXAS = [
  "custo de não fazer nada em R$ (precisa das taxas dos ativos atuais)",
  "regras do arquivo 09 (IR, FGC, macro) são de 08/10/2026: reconfirmar por busca antes de usar",
];

const MOTIVO_VALOR = "não está nos números calculados nem na fala do lead";

/** Regras que só dependem dos dados lidos: citação na transcrição e pendências. */
export function checarDados(lead: Lead, ativos: Ativo[], an: Analise, transcricao: string): [Aviso[], string[]] {
  const avisos: Aviso[] = [];
  const pend: string[] = [];
  const tn = norm(transcricao);
  for (const fr of lead.frases_literais)
    if (norm(fr) && !tn.includes(norm(fr)))
      avisos.push({ tipo: "citacao", texto: `Citação não encontrada literalmente na transcrição: "${fr.slice(0, 60)}…"`,
        motivo: "a frase atribuída ao lead não aparece igual na transcrição", trecho: fr });

  if (an.excedente_fgc > 0 && an.excedente_fgc_a_validar)
    pend.push("confirmar se os papéis bancários são do mesmo conglomerado (define o excedente do FGC)");
  const semLiq = ativos.filter((a) => !a.fora_do_depara && (!a.liquidez.trim() || a.liquidez.toLowerCase().includes("confirmar"))).map((a) => a.nome);
  if (semLiq.length) pend.push("liquidez diária × portabilidade, taxa, carência e vencimento de: " + [...new Set(semLiq)].join(", "));
  pend.push(...PENDENCIAS_FIXAS);
  return [avisos, pend];
}

export function checar(lead: Lead, ativos: Ativo[], an: Analise, aloc: Alocacao, diag: Diagnostico, dec: Decisao,
  notas: Notas, transcricao: string): [Aviso[], string[]] {
  const [avisosDados, pend] = checarDados(lead, ativos, an, transcricao);
  return [[...checarRascunho(lead, ativos, an, aloc, diag, dec, notas, transcricao), ...avisosDados], pend];
}

/** Onde cada campo do rascunho aparece no deck (nomes dos slides de app/deck/build.py). */
const ROTULOS: Record<string, string> = {
  frase_contradicao: "diagnóstico, frase de contradição",
  disse: "slide O que você disse × os números", titulo_disse: "slide O que você disse × os números, título",
  acertos: "slide O que você já faz bem", titulo_acertou: "slide O que você já faz bem, título",
  riscos: "slide Riscos", titulo_riscos: "slide Riscos, título",
  ganho_titulo: "slide O primeiro ganho, título", ganho_numero: "slide O primeiro ganho, número",
  ganho_descricao: "slide O primeiro ganho", ganho_detalhes: "slide O primeiro ganho", ganho_passos: "slide O primeiro ganho, passos",
  falta: "slide O que não está na carteira", perguntas: "slide Perguntas",
  hoje_numero: "slide A Decisão, número de hoje", hoje_texto: "slide A Decisão, texto de hoje", hoje_detalhes: "slide A Decisão, detalhes de hoje",
  pedido: "slide A Decisão, pedido", garantias: "slide A Decisão, garantias", condicoes: "slide A Decisão, condições",
  resumo_itens: "slide Resumo", frase_lead_repete: "notas do slide A Decisão", diferencial_motivo: "notas do slide Diferencial",
};

/** Textos de um modelo campo a campo, com o caminho (ex.: riscos[0].numero). */
function campos(v: unknown, caminho = ""): [string, string][] {
  if (typeof v === "string") return [[caminho, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => campos(x, `${caminho}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => campos(x, caminho ? `${caminho}.${k}` : k));
  return [];
}

/** Até ~80 caracteres em volta da posição. */
function trechoEmVolta(t: string, ini: number, fim: number, max = 80): string {
  if (t.length <= max) return t;
  const a = Math.max(0, Math.min(Math.round((ini + fim - max) / 2), t.length - max));
  return `${a > 0 ? "…" : ""}${t.slice(a, a + max).trim()}${a + max < t.length ? "…" : ""}`;
}

const brlInteiro = (v: number) => `R$ ${commaFixed(v, 0)}`.replace(/,/g, ".");
const onde = (campo: string) => `${campo.startsWith("notas") ? "nas" : "no"} ${campo}`;

export function checarRascunho(lead: Lead, ativos: Ativo[], an: Analise, aloc: Alocacao, diag: Diagnostico, dec: Decisao,
  notas: Notas, transcricao = ""): Aviso[] {
  const avisos: Aviso[] = [];

  const soma = aloc.classes.reduce((s, c) => s + c.pct_proposto, 0);
  if (Math.abs(soma - 100) > 0.5)
    avisos.push({ tipo: "alocacao", texto: `Proposta soma ${pyFixed(soma, 0)}% (esperado 100%).`, motivo: "a proposta do De → Para precisa somar 100%", campo: "slide De → Para" });

  const emissores = new Set([...ativos.filter((a) => a.emissor.trim()).map((a) => norm(a.emissor)), ...BANCOS.map(norm)]);
  for (const c of aloc.classes) {
    const t = norm(c.para_detalhe);
    if ([...emissores].some((e) => e && ` ${t} `.includes(` ${e} `)))
      avisos.push({ tipo: "emissor", texto: `'Para' de ${c.classe} cita emissor/produto: "${c.para_detalhe}".`,
        motivo: "o 'Para' descreve a classe, sem emissor nem produto", campo: "slide De → Para", trecho: c.para_detalhe });
  }

  const modelo = calc.modeloDoPerfil(lead.perfil);
  for (const c of aloc.classes)
    if (Math.abs(c.pct_proposto - modelo[c.classe]) > 5 && c.porque.trim().length < 8)
      avisos.push({ tipo: "alocacao", texto: `${c.classe} desvia mais de 5 p.p. do modelo sem motivo escrito.`,
        motivo: "desvio de mais de 5 p.p. do modelo do perfil precisa de motivo escrito", campo: "slide De → Para" });
  if (lead.perfil === "Conservador")
    for (const c of aloc.classes)
      if (["Ações Brasil", "RV Internacional", "FIIs", "Alternativos"].includes(c.classe) && c.pct_proposto > 0)
        avisos.push({ tipo: "alocacao", texto: `${c.classe} ${pyFixed(c.pct_proposto, 0)}% acima do risco do perfil Conservador (reavaliar suitability).`,
          motivo: "classe de risco acima do perfil Conservador", campo: "slide De → Para" });

  const dDiag = dumpModel(diag, "Diagnostico"), dDec = dumpModel(dec, "Decisao");
  const textos = [dDiag, dDec, dumpModel(notas, "Notas"), dumpModel(aloc, "Alocacao")].join("\n");
  for (const m of textos.matchAll(PROMESSA))
    avisos.push({ tipo: "promessa", texto: `Possível promessa de rentabilidade: "${m[0]}".`, motivo: "o método não permite prometer rentabilidade", trecho: m[0] });
  for (const p of PROIBIDO)
    if (textos.toLowerCase().includes(p))
      avisos.push({ tipo: "proibido", texto: `Expressão proibida pelo método: "${p}".`, motivo: "expressão proibida pelo método", trecho: p });

  // Fontes válidas: números calculados, proposta, aporte e o que o lead disse (dados extraídos e fala na transcrição).
  const fatos = new Set<number>();
  for (const f of calc.fatosParaPrompt(an, lead.perfil)) for (const v of valores(f)) fatos.add(pyRound(v));
  for (const c of aloc.classes) fatos.add(pyRound((an.total * c.pct_proposto) / 100));
  for (const c of aloc.classes) fatos.add(pyRound(Math.abs((an.total * c.pct_proposto) / 100 - an.por_classe[c.classe])));
  fatos.add(pyRound(lead.aporte_mensal));
  const doLead = [...lead.objetivos, ...lead.situacao, ...lead.restricoes, lead.meta_patrimonio_citada, ...lead.frases_literais].join("\n");
  for (const v of [...valores(doLead), ...numerosCitados(doLead), ...numerosCitados(transcricao)]) fatos.add(pyRound(v));

  // Um aviso por valor, no primeiro campo em que aparece, com a contagem.
  const porValor = new Map<number, { campo: string; trecho: string; n: number; onde: Set<string> }>();
  for (const [caminho, bruto] of [...campos(JSON.parse(dDiag)), ...campos(JSON.parse(dDec))]) {
    const s = bruto.replace(/\s+/g, " ").trim();
    for (const m of s.matchAll(VALOR)) {
      const v = valores(m[0])[0];
      if (v === undefined || v <= 1000 || [...fatos].some((f) => Math.abs(v - f) <= Math.max(1000, f * 0.02))) continue;
      const k = pyRound(v), atual = porValor.get(k);
      const raiz = caminho.match(/^[a-z_]+/)?.[0] ?? caminho, campo = ROTULOS[raiz] ?? raiz;
      if (atual) { atual.n++; atual.onde.add(campo); continue; }
      porValor.set(k, { campo, trecho: trechoEmVolta(s, m.index!, m.index! + m[0].length), n: 1, onde: new Set([campo]) });
    }
  }
  for (const [v, o] of porValor) {
    const lugares = o.onde.size > 1 ? ` (${[...o.onde].join("; ")})` : "";
    avisos.push({ tipo: "valor", valor: v, campo: o.campo, trecho: o.trecho, ocorrencias: o.n, motivo: MOTIVO_VALOR,
      texto: `${brlInteiro(v)} ${onde(o.campo)} ("${o.trecho}"): ${MOTIVO_VALOR}. Confira.${o.n > 1 ? ` Aparece em ${o.n} trechos${lugares}.` : ""}` });
  }
  return avisos;
}
