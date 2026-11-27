/**
 * Servidor do Container `Extrator`: recebe os bytes de um .pdf/.xlsx/.xls e devolve o texto, reaproveitando lib/ingest.ts.
 *
 *   POST /extrair?nome=arquivo.pdf   corpo = bytes   ->  200 { texto, truncado }   (4xx/5xx { erro })
 *   GET  /health                                      ->  200 { ok: true }
 *
 * - Uma extração por vez: um xlsx de 25 MB chega a 1,4 GB de RSS (docs/FASE0_RELATORIO.md); as demais esperam a sua vez.
 * - O conteúdo do arquivo e o texto extraído nunca são registrados em log nem vão para o disco.
 * - Só aceita as extensões que o Worker não extrai por conta própria.
 */
import http from "node:http";
import path from "node:path";
import { toText } from "../../lib/ingest";

const PORTA = Number(process.env.PORT ?? 8181);
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;
/** O prompt usa ~200 mil caracteres de transcrição; 37 milhões de um xlsx sintético não servem para nada (FASE0_RELATORIO). */
const MAX_CHARS = Number(process.env.EXTRATOR_MAX_CHARS ?? 2_000_000);
const EXT_SUPORTADAS = new Set([".pdf", ".xlsx", ".xls"]);

const json = (res: http.ServerResponse, status: number, corpo: unknown) => {
  const buf = Buffer.from(JSON.stringify(corpo));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
};

class ErroHttp extends Error {
  constructor(readonly status: number, mensagem: string) { super(mensagem); }
}

async function lerCorpo(req: http.IncomingMessage): Promise<Buffer> {
  const declarado = Number(req.headers["content-length"]);
  if (Number.isFinite(declarado) && declarado > MAX_BYTES) throw new ErroHttp(413, "Arquivo maior que o permitido.");
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > MAX_BYTES) throw new ErroHttp(413, "Arquivo maior que o permitido.");
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes, total);
}

// Fila de execução: cada extração começa quando a anterior termina (sucesso ou erro).
let cauda: Promise<unknown> = Promise.resolve();
function emSerie<T>(fn: () => Promise<T>): Promise<T> {
  const r = cauda.then(fn, fn);
  cauda = r.catch(() => undefined);
  return r;
}

async function extrair(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const nome = url.searchParams.get("nome") ?? "";
  const ext = path.extname(nome).toLowerCase();
  if (!EXT_SUPORTADAS.has(ext)) throw new ErroHttp(415, "Formato não suportado pelo extrator.");
  const corpo = await lerCorpo(req);
  if (!corpo.length) throw new ErroHttp(400, "Arquivo vazio.");
  const texto = await emSerie(() => toText(nome, corpo));
  const truncado = texto.length > MAX_CHARS;
  json(res, 200, { texto: truncado ? texto.slice(0, MAX_CHARS) : texto, truncado });
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://extrator.local");
  const tratar = async () => {
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/extrair") return extrair(req, res, url);
    throw new ErroHttp(404, "Rota inexistente.");
  };
  tratar().catch((e: unknown) => {
    if (res.headersSent) return res.destroy();
    if (e instanceof ErroHttp) return json(res, e.status, { erro: e.message });
    // toText lança mensagens em português pensadas para a tela ("Não consegui extrair texto de ..."). Elas citam o nome do
    // arquivo, que pode ter o nome do cliente: voltam na resposta, mas não vão para o log.
    console.error(`[extrator] falha na extração (${e instanceof Error ? e.name : "desconhecido"})`);
    json(res, 422, { erro: e instanceof Error ? e.message.slice(0, 300) : "Não consegui extrair o texto do arquivo." });
  });
});

servidor.requestTimeout = 0; // extrações grandes levam dezenas de segundos
servidor.listen(PORTA, "0.0.0.0", () => console.log(`[extrator] ouvindo na porta ${PORTA}`));
for (const sinal of ["SIGTERM", "SIGINT"] as const) process.on(sinal, () => servidor.close(() => process.exit(0)));
