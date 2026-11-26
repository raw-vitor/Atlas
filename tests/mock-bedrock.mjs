// Mock do Bedrock Runtime para testar o Atlas sem chamar a AWS. Uso: node tests/mock-bedrock.mjs [porta]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const canned = JSON.parse(fs.readFileSync(path.join(dir, "fixtures/canned.json"), "utf-8"));
const porta = Number(process.argv[2] ?? 8199);

function checarSchema(node, caminho = "") {
  const proibidas = ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"];
  if (Array.isArray(node)) return node.flatMap((n, i) => checarSchema(n, `${caminho}[${i}]`));
  if (!node || typeof node !== "object") return [];
  const erros = proibidas.filter((k) => k in node).map((k) => `${caminho}: ${k} não suportado`);
  if (node.type === "object" && node.properties && node.additionalProperties !== false) erros.push(`${caminho}: falta additionalProperties:false`);
  for (const [k, v] of Object.entries(node)) erros.push(...checarSchema(v, `${caminho}/${k}`));
  return erros;
}

http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const b = JSON.parse(corpo || "{}");
    const js = b.outputConfig?.textFormat?.structure?.jsonSchema;
    const auth = req.headers.authorization;
    let resposta;
    if (!js) resposta = "| CDB DI | 729.546,02 |\n| CDB DI | 10.122,60 |";
    else {
      const erros = checarSchema(JSON.parse(js.schema));
      if (erros.length) { res.writeHead(400); return res.end(JSON.stringify({ message: "Schema inválido: " + erros.slice(0, 3).join("; ") })); }
      const daTranscricao = js.name === "AtivosOut" && JSON.stringify(b.system ?? "").includes("O LEAD diz ter hoje");
      resposta = daTranscricao
        ? { ativos: [{ nome: "CDB", emissor: "a confirmar", classe: "Pós-fixado", subclasse: "Bancário com FGC", liquidez: "a confirmar", vencimento: "a confirmar", valor: 600000, fora_do_depara: false }], data_posicao: "" }
        : js.name === "Resposta" && JSON.parse(js.schema).properties.usar_transcricao
          ? { usar_transcricao: /transcri/i.test(JSON.stringify(b.messages)), primeiro_nome: "", perfil: "", objetivos: [] }
          : js.name === "Resposta" ? (JSON.parse(js.schema).properties.ok ? { ok: true } : { indice_carteira: 0, indice_transcricao: 1 }) : canned[js.name];
    }
    if (process.env.MOCK_VERBOSE) console.log(req.method, req.url, js?.name, auth ? "bearer" : "sem-auth");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      output: { message: { role: "assistant", content: [{ text: typeof resposta === "string" ? resposta : JSON.stringify(resposta) }] } },
      stopReason: "end_turn", usage: { inputTokens: 1000, outputTokens: 300 },
    }));
  });
}).listen(porta, "127.0.0.1", () => console.log("mock bedrock na porta", porta));
