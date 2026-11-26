import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

const cache = new Map<string, string>();

function load(prefix: string): string {
  if (cache.has(prefix)) return cache.get(prefix)!;
  let txt = "";
  try {
    const f = fs.readdirSync(config.knowledgeDir).filter((n) => n.startsWith(prefix + "_") && n.endsWith(".md")).sort()[0];
    if (f) txt = fs.readFileSync(path.join(config.knowledgeDir, f), "utf-8");
  } catch { /* pasta ausente: vazio, como no Python */ }
  cache.set(prefix, txt);
  return txt;
}

/** Concatena arquivos de conhecimento pelo número (ex.: kb("04", "05")). */
export function kb(...prefixes: string[]): string {
  return prefixes.map(load).filter(Boolean).join("\n\n=====\n\n");
}
