#!/usr/bin/env node
// Mede extração no Worker de spike: para cada fixture sobe um `wrangler dev` novo (isolate limpo), aquece,
// lê o RSS do processo workerd antes, amostra durante a requisição e reporta o pico.
// process.memoryUsage() no Workers devolve zeros, então o RSS do workerd (fora do isolate) é a medida disponível.
// Uso: node spike/medir.mjs [arquivo ...]   (padrão: todos os de spike/.fixtures)
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(aqui, ".fixtures");
const PORTA = 8793;
const arquivos = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(fx).sort();
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const rss = (pid) => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf-8"))[1]) / 1024; } catch { return null; } };

// O wrangler dev sobe dois workerd: um proxy (~100 MB fixos) e o que roda o Worker do spike. Pegamos todos os filhos
// diretos do wrangler e usamos o de maior RSS como "o Worker".
// wrangler/bin/wrangler.js relança o CLI como processo filho, então os workerd são netos: percorre os descendentes.
const filhosWorkerd = (pai) => {
  const todos = execSync("ps -e -o pid=,ppid=,comm= || true").toString().split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 3);
  const alvo = new Set([pai]);
  for (let mudou = true; mudou;) { mudou = false; for (const [pid, ppid] of todos) if (alvo.has(Number(ppid)) && !alvo.has(Number(pid))) { alvo.add(Number(pid)); mudou = true; } }
  return todos.filter((c) => c[2] === "workerd" && alvo.has(Number(c[0]))).map((c) => Number(c[0]));
};
const pidWorker = (pai) => filhosWorkerd(pai).sort((a, b) => (rss(b) ?? 0) - (rss(a) ?? 0))[0];
let logFd;
async function subir() {
  // stdout/stderr do wrangler vão para um log por execução, para procurar "exceeded memory"/reinício do isolate
  fs.mkdirSync(path.join(aqui, "resultados"), { recursive: true });
  logFd = fs.openSync(path.join(aqui, "resultados", "wrangler-atual.log"), "w");
  const p = spawn(path.join(aqui, "../node_modules/.bin/wrangler"), ["dev", "--port", String(PORTA), "--inspector-port", "9331", "--show-interactive-dev-session=false"], { cwd: aqui, detached: true, stdio: ["ignore", logFd, logFd] });
  for (let i = 0; i < 120; i++) { await dorme(500); try { if ((await fetch(`http://localhost:${PORTA}/info`)).ok) return p; } catch { /* ainda subindo */ } }
  throw new Error("wrangler dev não subiu");
}
const matar = async (p) => { try { process.kill(-p.pid, "SIGTERM"); } catch { /* já saiu */ } await dorme(1500); };

const resultados = [];
for (const nome of arquivos) {
  const arq = path.isAbsolute(nome) ? nome : path.join(fx, nome);
  const buf = fs.readFileSync(arq);
  const p = await subir();
  try {
    const pid = p.pid;
    // aquece: carrega todos os módulos e libs antes da linha de base
    await fetch(`http://localhost:${PORTA}/extrair?nome=a.txt`, { method: "POST", body: "texto de aquecimento com mais de vinte caracteres" });
    await dorme(500);
    const pw = pidWorker(pid);
    const base = rss(pw);
    let pico = base;
    const timer = setInterval(() => { const r = rss(pw); if (r && r > pico) pico = r; }, 25);
    const t0 = Date.now();
    let resp, erro;
    try {
      const r = await fetch(`http://localhost:${PORTA}/extrair?nome=${encodeURIComponent(path.basename(arq))}`, { method: "POST", body: buf, signal: AbortSignal.timeout(120000) });
      resp = await r.json().catch(() => ({ http: r.status }));
      resp.http = r.status;
    } catch (e) { erro = String(e).slice(0, 200); }
    const ms = Date.now() - t0;
    clearInterval(timer);
    await dorme(300);
    const vivo = filhosWorkerd(pid).length > 0;
    const pwDepois = vivo ? pidWorker(pid) : null;
    const log = fs.readFileSync(path.join(aqui, "resultados", "wrangler-atual.log"), "utf-8");
    const sinaisMemoria = [...new Set((log.match(/.*(exceeded memory|memory limit|out of memory|OOM|isolate.*(reset|restart)|Worker exceeded).*/gi) ?? []).map((l) => l.trim().slice(0, 160)))];
    const linha = { arq: path.basename(arq), mb: +(buf.length / 1048576).toFixed(1), ok: resp?.ok === true, ms, chars: resp?.chars, baseMB: Math.round(base), picoMB: Math.round(pico), deltaMB: Math.round(pico - base), workerdVivo: vivo, workerdReiniciou: pwDepois !== pw, sinaisMemoriaNoLog: sinaisMemoria, erro: erro ?? resp?.erro };
    resultados.push(linha);
    console.log(JSON.stringify(linha));
  } finally { await matar(p); try { fs.closeSync(logFd); } catch { /* já fechado */ } }
}
fs.mkdirSync(path.join(aqui, "resultados"), { recursive: true });
fs.writeFileSync(path.join(aqui, "resultados", `medicao-${Date.now()}.jsonl`), resultados.map((r) => JSON.stringify(r)).join("\n") + "\n");
