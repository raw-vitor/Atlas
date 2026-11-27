/** Valores em reais citados numa transcrição, achados em código (sem LLM). */

const UNIDADE = "mil|milh(?:ão|ões|ao|oes)";
const NUM = "\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?";
// R$ 600 mil | R$ 600.000 | 600 mil reais | 1,2 milhão | 600 mil
const VALOR = new RegExp(
  `R\\$\\s*(?:${NUM})(?:\\s*(?:${UNIDADE})(?![\\p{L}]))?` +
  `|(?:${NUM})\\s*(?:${UNIDADE})?\\s*reais(?![\\p{L}])` +
  `|(?:${NUM})\\s*(?:${UNIDADE})(?![\\p{L}])`, "giu");

/** Fala do assessor: o valor tem que vir do lead. */
const FALA_ASSESSOR = /^\s*(?:\[[^\]]*\]\s*)?assessor(?:a)?\b\s*[:\-]/i;
const MAX_PALAVRAS_CONTEXTO = 6;
const MAX_TRECHOS = 3;

export function valoresCitados(texto: string): string[] {
  const out: string[] = [];
  for (const linha of texto.split(/\r\n|\r|\n/)) {
    if (FALA_ASSESSOR.test(linha)) continue;
    const corpo = linha.replace(/^\s*[\p{L}][\p{L} ]{0,30}:\s*/u, (m) => (/^\s*(?:lead|cliente)\s*:/i.test(m) ? "" : m));
    for (const m of corpo.matchAll(VALOR)) {
      const fim = m.index! + m[0].length;
      const resto = corpo.slice(fim).split(/[.!?;]/)[0];
      const contexto = resto.trim().split(/\s+/).filter(Boolean).slice(0, MAX_PALAVRAS_CONTEXTO).join(" ").replace(/[,:\s]+$/, "");
      const trecho = `${m[0].trim()}${contexto ? " " + contexto : ""}`;
      if (!out.includes(trecho)) out.push(trecho);
      if (out.length >= MAX_TRECHOS) return out;
    }
  }
  return out;
}

/** Número de um trecho achado por VALOR: "R$ 10 mil" → 10000, "1,2 milhão" → 1200000, "R$ 10.000" → 10000. */
function numeroDoTrecho(t: string): number | null {
  const n = t.match(new RegExp(NUM))?.[0];
  if (!n) return null;
  const v = Number(n.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(v)) return null;
  const u = t.slice(t.indexOf(n) + n.length).toLowerCase();
  return v * (/^\s*milh/.test(u) ? 1e6 : /^\s*mil/.test(u) ? 1e3 : 1);
}

/** Todos os valores em reais ditos pelo lead (sem o limite de valoresCitados), como números. Ignora a fala do assessor. */
export function numerosCitados(texto: string): number[] {
  const out: number[] = [];
  for (const linha of texto.split(/\r\n|\r|\n/)) {
    if (FALA_ASSESSOR.test(linha)) continue;
    for (const m of linha.matchAll(VALOR)) {
      const v = numeroDoTrecho(m[0]);
      if (v !== null) out.push(v);
    }
  }
  return out;
}
