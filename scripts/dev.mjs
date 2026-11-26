#!/usr/bin/env node
/**
 * npm run dev: sobe o deck-service (Python) e o Next juntos. Ctrl+C encerra os dois.
 * - Se já há um deck-service no ar com o mesmo schema, reaproveita e não o encerra no fim.
 * - Se o que está no ar tem schema diferente, para com a instrução de reiniciar (não encerra processo alheio).
 * - DECK_SERVICE_URL e as chaves do Bedrock vêm de .env / .env.local / ambiente.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(raiz, "..");
const log = (m) => console.log(`\x1b[36m[atlas]\x1b[0m ${m}`);
const falhar = (m) => { console.error(`\x1b[31m[atlas]\x1b[0m ${m}`); process.exit(1); };

function lerEnv() {
  const env = {};
  for (const arq of [".env", ".env.local"]) {
    const p = path.join(raiz, arq);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return { ...env, ...process.env };
}
const env = lerEnv();
const url = new URL((env.DECK_SERVICE_URL || "http://127.0.0.1:8180").trim());
const hashEsperado = JSON.parse(fs.readFileSync(path.join(raiz, "lib/schemas/constantes.json"), "utf-8")).SCHEMA_HASH;

// ---- pré-requisitos
if (!fs.existsSync(path.join(repo, ".venv/bin/uvicorn"))) falhar("Faltam as dependências Python. Rode: python3 -m venv ../.venv && ../.venv/bin/pip install -r ../deck-service/requirements.txt");
if (!fs.existsSync(path.join(raiz, "node_modules"))) falhar("Faltam as dependências Node. Rode: npm install");
const knowledge = path.resolve(raiz, env.KNOWLEDGE_DIR || "../conhecimento");
if (!fs.existsSync(knowledge)) falhar(`Pasta do método não encontrada: ${knowledge} (KNOWLEDGE_DIR).`);
if (!env.BEDROCK_API_KEY && !env.AWS_BEARER_TOKEN_BEDROCK && !env.AWS_ACCESS_KEY_ID && !env.AWS_PROFILE)
  log("Aviso: nenhuma credencial do Bedrock encontrada (BEDROCK_API_KEY). O chat vai falhar ao chamar a LLM.");
if (spawnSync("which", ["soffice"]).status !== 0) log("Aviso: soffice (LibreOffice) não encontrado. O deck em PDF não será gerado.");

async function saude() {
  try {
    const r = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { estado: "erro" };
    const j = await r.json().catch(() => ({}));
    return { estado: j.schema_hash === hashEsperado ? "ok" : "desatualizado" };
  } catch { return { estado: "fora" }; }
}

const filhos = [];
let encerrando = false;
function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const f of filhos) { try { process.kill(-f.pid, "SIGTERM"); } catch { /* já saiu */ } }
  setTimeout(() => process.exit(codigo), 500).unref();
}
process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));

function iniciar(nome, cmd, args, opts) {
  const f = spawn(cmd, args, { stdio: "inherit", detached: true, ...opts });
  filhos.push(f);
  f.on("exit", (code, sig) => {
    if (encerrando) return;
    log(`${nome} encerrou (${sig ?? code}). Encerrando o resto.`);
    encerrar(code ?? 1);
  });
  return f;
}

const s = await saude();
if (s.estado === "desatualizado")
  falhar(`Já existe um deck-service em ${url.origin} com o schema desatualizado. Encerre-o e rode de novo:\n  kill $(lsof -ti :${url.port || 80})`);
if (s.estado === "erro") falhar(`Algo responde em ${url.origin}/health mas não é o deck-service. Libere a porta ${url.port} ou mude DECK_SERVICE_URL.`);

if (s.estado === "ok") log(`deck-service já está no ar em ${url.origin}. Reaproveitando.`);
else {
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname))
    falhar(`DECK_SERVICE_URL aponta para ${url.origin}, que não está respondendo e não é local. Suba esse serviço ou use o endereço local.`);
  log(`Subindo o deck-service em ${url.origin}`);
  iniciar("deck-service", path.join(repo, "deck-service/run.sh"), [], {
    env: { ...process.env, HOST: url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[|\]$/g, ""), PORT: url.port || "8180", RELOAD: "1" } });
  const limite = Date.now() + 90_000;
  for (;;) {
    if (encerrando) break;
    const h = await saude();
    if (h.estado === "ok") break;
    if (h.estado === "desatualizado") { encerrar(1); falhar("O deck-service subiu com schema diferente do Atlas. Rode: ../.venv/bin/python ../deck-service/export_schemas.py"); }
    if (Date.now() > limite) { encerrar(1); falhar("O deck-service não respondeu em 90 s."); }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!encerrando) log("deck-service pronto.");
}

if (!encerrando) {
  log("Subindo o Next em http://localhost:3000");
  iniciar("next", path.join(raiz, "node_modules/.bin/next"), ["dev", ...process.argv.slice(2)], { cwd: raiz, env: process.env });
}
