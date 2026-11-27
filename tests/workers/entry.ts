/**
 * Entry do Worker de teste (tests/workers/wrangler.test.jsonc). Expõe, por HTTP, o que os testes precisam exercitar dentro do
 * runtime do Worker: chamadas RPC ao Durable Object `Conversa` e o consumidor real da fila (`processarLote`).
 *   POST /rpc/{conversaId}/{metodo}   corpo: JSON com a lista de argumentos   ->  { resultado }
 *   GET  /sse/{conversaId}            (Last-Event-ID opcional)                ->  text/event-stream
 */
import { Conversa } from "../../workers/conversa";
import { processarLote } from "../../lib/tarefas";

export { Conversa };

export interface EnvTeste {
  DB: D1Database;
  ARQUIVOS: R2Bucket;
  TAREFAS: Queue;
  CONVERSA: DurableObjectNamespace<Conversa>;
  ENVIRONMENT: string;
}

export default {
  async fetch(req: Request, env: EnvTeste): Promise<Response> {
    const url = new URL(req.url);
    const [, rota, id, metodo] = url.pathname.split("/");
    if (rota === "rpc" && req.method === "POST") {
      const stub = env.CONVERSA.get(env.CONVERSA.idFromName(id)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      if (typeof stub[metodo] !== "function") return Response.json({ erro: `método ${metodo} inexistente` }, { status: 404 });
      const args = (await req.json()) as unknown[];
      return Response.json({ resultado: (await stub[metodo](...args)) ?? null });
    }
    if (rota === "sse") {
      const stub = env.CONVERSA.get(env.CONVERSA.idFromName(id));
      return stub.sse(req.headers.get("last-event-id"));
    }
    if (rota === "enfileirar" && req.method === "POST") {
      await env.TAREFAS.send(await req.json());
      return Response.json({ ok: true });
    }
    return new Response("atlas-teste", { status: 200 });
  },

  async queue(lote: MessageBatch<unknown>, env: EnvTeste, ctx: ExecutionContext) {
    await processarLote(lote, env as unknown as CloudflareEnv, ctx);
  },
} satisfies ExportedHandler<EnvTeste>;
