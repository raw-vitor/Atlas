/**
 * Gera lib/validadores.gerado.js: validadores do Ajv em modo standalone, sem `new Function` em runtime
 * (o Workers proíbe geração de código a partir de string). Mesmas opções de antes: strict false, allErrors false.
 * Rode: npm run gerar
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOMES = ["AtivosOut", "Lead", "Alocacao", "Diagnostico", "Decisao", "Notas"];

const ajv = new Ajv({ strict: false, allErrors: false, code: { source: true, esm: true } });
const refs = {};
for (const nome of NOMES) {
  const schema = JSON.parse(fs.readFileSync(path.join(raiz, "lib/schemas", `${nome}.json`), "utf-8"));
  ajv.addSchema(schema, nome);
  refs[nome] = nome;
}
let codigo = standaloneCode(ajv, refs);
codigo = "/* eslint-disable */\n// GERADO por scripts/gerar-validadores.mjs a partir de lib/schemas/*.json. Não edite à mão.\n" + codigo;
if (/new Function|\beval\(|\brequire\(/.test(codigo)) {
  console.error("O código gerado usa new Function/eval/require. Ajuste as opções do standalone.");
  process.exit(1);
}
const saida = path.join(raiz, "lib/validadores.gerado.js");
if (!fs.existsSync(saida) || fs.readFileSync(saida, "utf-8") !== codigo) fs.writeFileSync(saida, codigo);

fs.writeFileSync(path.join(raiz, "lib/validadores.gerado.d.ts"), `// GERADO por scripts/gerar-validadores.mjs. Não edite à mão.
export interface ErroValidacao { instancePath: string; message?: string }
export interface Validador { (data: unknown): boolean; errors?: ErroValidacao[] | null }
${NOMES.map((n) => `export const ${n}: Validador;`).join("\n")}
`);
console.log(`validadores gerados: ${NOMES.length}`);
