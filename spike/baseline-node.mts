// Referência: mesma extração rodando em Node (o que o Atlas faz hoje). Uso: npx tsx spike/baseline-node.ts <arquivo>
import fs from "node:fs";
import path from "node:path";
import { toText } from "../lib/ingest.ts";

const arq = process.argv[2];
const buf = fs.readFileSync(arq);
const base = process.memoryUsage().rss;
const t0 = performance.now();
try {
  const txt = await toText(path.basename(arq), buf);
  console.log(JSON.stringify({ arq: path.basename(arq), ok: true, chars: txt.length, ms: Math.round(performance.now() - t0), rssPicoMB: Math.round(process.memoryUsage().rss / 1048576), rssBaseMB: Math.round(base / 1048576) }));
} catch (e) {
  console.log(JSON.stringify({ arq: path.basename(arq), ok: false, erro: String(e).slice(0, 200), ms: Math.round(performance.now() - t0) }));
}
