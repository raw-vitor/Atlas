/** Funções que reproduzem o comportamento de formatação do Python usado nos prompts. */

/** round() do Python: metade vai para o par mais próximo. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** f"{v:.Nf}" do Python: em empate exato, arredonda para o par (toFixed arredonda para longe de zero). */
export function pyFixed(v: number, d: number): string {
  const a = Math.abs(v);
  const exato = a.toFixed(Math.min(100, d + 30));
  const resto = exato.slice(exato.indexOf(".") + 1 + d);
  const sinal = v < 0 || Object.is(v, -0) ? "-" : "";
  if (/^50*$/.test(resto)) {
    const trunc = d === 0 ? exato.slice(0, exato.indexOf(".")) : exato.slice(0, exato.indexOf(".") + 1 + d);
    if (Number(trunc.slice(-1)) % 2 === 0) return sinal + trunc;
  }
  return sinal + a.toFixed(d);
}

export function groupThousands(intStr: string, sep = ","): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** f"{v:,.Nf}" */
export function commaFixed(v: number, d: number): string {
  const s = pyFixed(Math.abs(v), d);
  const [i, f] = s.split(".");
  const neg = v < 0 ? "-" : "";
  return neg + groupThousands(i) + (f ? "." + f : "");
}

/** json.dumps(obj, ensure_ascii=False): separadores ", " e ": ". */
export function pyDumps(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(pyDumps).join(", ") + "]";
  if (v && typeof v === "object")
    return "{" + Object.entries(v as object).map(([k, x]) => JSON.stringify(k) + ": " + pyDumps(x)).join(", ") + "}";
  return JSON.stringify(v);
}
