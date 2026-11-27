import { CONHECIMENTO } from "./knowledge.gerado";

/** Base de conhecimento embutida no bundle por scripts/gerar-conhecimento.mjs (sem fs). Prefixo ausente = vazio. */
const load = (prefix: string): string => Object.hasOwn(CONHECIMENTO, prefix) ? CONHECIMENTO[prefix] : "";

/** Concatena arquivos de conhecimento pelo número (ex.: kb("04", "05")). */
export function kb(...prefixes: string[]): string {
  return prefixes.map(load).filter(Boolean).join("\n\n=====\n\n");
}
