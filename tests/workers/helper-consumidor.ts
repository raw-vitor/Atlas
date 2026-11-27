/**
 * Sobe o Worker de teste do consumidor (wrangler.consumidor.jsonc) no runtime local do wrangler, apontando o Bedrock para o mock do
 * teste. Separado de helper.ts para não mexer no que os outros testes de workers usam.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import type { EnvConsumidor } from "./consumidor.entry";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface ResultadoLote { ack: boolean; retry: { delaySeconds?: number } | null }
export interface EventoDo { id: number; evento: string; dados: Record<string, unknown> }

export function criarServidorConsumidor(bedrockUrl: string, vars: Record<string, string> = {}) {
  const server = createTestHarness({
    root: raiz,
    workers: [{ configPath: "tests/workers/wrangler.consumidor.jsonc", vars: { BEDROCK_ENDPOINT: bedrockUrl, ...vars } }],
  });
  const worker = server.getWorker<EnvConsumidor>();
  // Os tipos de `fetch` do wrangler (undici) brigam com os do lib "dom" do projeto; aqui o formato é o do fetch padrão.
  const buscar = (url: string, init?: unknown) => (server.fetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  const postar = (url: string, corpo: unknown) =>
    buscar(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

  /** Chama um método RPC do Durable Object da conversa (o caminho real das rotas). */
  async function rpc<T = unknown>(conversaId: string, metodo: string, ...args: unknown[]): Promise<T> {
    const r = await postar(`/rpc/${conversaId}/${metodo}`, args);
    const corpo = (await r.json()) as { resultado?: T; erro?: string };
    if (!r.ok) throw new Error(corpo.erro ?? `RPC ${metodo} falhou (${r.status})`);
    return corpo.resultado as T;
  }

  /** Entrega uma mensagem ao consumidor real, como a fila faria, e espera ele terminar. */
  async function lote(corpo: unknown, tentativa = 1): Promise<ResultadoLote> {
    return (await (await postar("/teste/lote", { corpo, tentativa })).json()) as ResultadoLote;
  }

  /** Envia à fila real (o miniflare a entrega ao `queue` do Worker). */
  const enfileirar = (corpo: unknown) => postar("/teste/enfileirar", corpo);

  const eventos = (conversaId: string) => rpc<EventoDo[]>(conversaId, "eventosDesde", 0, 2000);
  const estado = (conversaId: string) => rpc<{ tarefa: { id: string; status: string; tipo: string } | null; contexto: Record<string, unknown> | null }>(conversaId, "estado");

  return { server, worker, buscar, rpc, lote, enfileirar, eventos, estado };
}

export type ServidorConsumidor = ReturnType<typeof criarServidorConsumidor>;

/** Repete `fn` até `ok` aceitar o valor (ou estourar o prazo). */
export async function ate<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > fim) throw new Error(`Condição não atendida a tempo: ${JSON.stringify(v)}`);
    await new Promise((res) => setTimeout(res, 50));
  }
}
