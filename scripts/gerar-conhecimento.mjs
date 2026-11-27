/**
 * Gera lib/knowledge.gerado.ts: mapa prefixo -> texto dos .md da base de conhecimento (KNOWLEDGE_DIR, padrão ../conhecimento).
 * O Worker não tem sistema de arquivos, então a base entra no bundle. O arquivo gerado fica fora do git (conteúdo interno).
 * Pasta ausente gera mapa vazio, como o kb() fazia antes. Rode: npm run gerar
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(raiz, (process.env.KNOWLEDGE_DIR ?? "").trim() || "../conhecimento");

const mapa = {};
let arquivos = [];
try { arquivos = fs.readdirSync(dir).filter((n) => /^[^_]+_.*\.md$/.test(n)).sort(); } catch { /* pasta ausente: mapa vazio */ }
for (const n of arquivos) {
  const prefixo = n.slice(0, n.indexOf("_"));
  if (!(prefixo in mapa)) mapa[prefixo] = fs.readFileSync(path.join(dir, n), "utf-8"); // primeiro em ordem alfabética
}

const texto = `// GERADO por scripts/gerar-conhecimento.mjs. Não edite nem versione (conteúdo interno).
export const CONHECIMENTO: Record<string, string> = ${JSON.stringify(mapa, null, 1)};
`;
const saida = path.join(raiz, "lib/knowledge.gerado.ts");
if (!fs.existsSync(saida) || fs.readFileSync(saida, "utf-8") !== texto) fs.writeFileSync(saida, texto);
console.log(`conhecimento gerado: ${Object.keys(mapa).length} arquivos de ${dir}`);
