/**
 * Entry do Worker de teste do consumidor (tests/workers/wrangler.consumidor.jsonc): o consumidor real da fila (`processarLote`) com
 * D1, R2 e o Durable Object `Conversa` reais do runtime local, e dublês dos dois Containers (`EXTRATOR` e `DECK`) como Durable Objects
 * com a mesma interface `fetch`. O Bedrock é um servidor HTTP do próprio teste (BEDROCK_ENDPOINT).
 *   POST /rpc/{conversaId}/{metodo}   corpo: lista de argumentos    ->  { resultado }
 *   POST /teste/lote                  { corpo, tentativa }          ->  roda `processarLote` com uma mensagem simulada: { ack, retry }
 *   POST /teste/enfileirar            mensagem                      ->  envia à fila real (o miniflare entrega ao `queue`)
 */
import { DurableObject } from "cloudflare:workers";
import constantes from "../../lib/schemas/constantes.json";
import { processarLote } from "../../lib/tarefas";
import { Conversa } from "../../workers/conversa";

export { Conversa };

const dec = new TextDecoder();

/** Dublê do Container `Extrator`: devolve o corpo como texto. "FALHA422" recusa o arquivo; "INSTAVEL" dá 503 na primeira chamada. */
export class ExtratorFalso extends DurableObject {
  private chamadas = 0;
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/extrair" || req.method !== "POST") return Response.json({ erro: "rota" }, { status: 404 });
    this.chamadas++;
    const texto = dec.decode(await req.arrayBuffer());
    if (texto.startsWith("FALHA422")) return Response.json({ erro: "Não consegui extrair o texto do PDF (dublê)." }, { status: 422 });
    if (texto.startsWith("INSTAVEL") && this.chamadas === 1) return new Response("reiniciando", { status: 503 });
    return Response.json({ texto, truncado: false });
  }
}

/** Dublê do Container `DeckService`. O assessor "Lento" faz o /render esperar até o pedido ser abortado. */
export class DeckFalso extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true, schema_hash: constantes.SCHEMA_HASH });
    if (url.pathname !== "/render" || req.method !== "POST") return Response.json({ erro: "rota" }, { status: 404 });
    const p = (await req.json()) as { formato: "pptx" | "pdf"; nome_arquivo: string };
    if (p.nome_arquivo.endsWith("_Lento"))
      await new Promise<void>((_ok, falha) => req.signal.addEventListener("abort", () => falha(new Error("abortado"))));
    return new Response(`${p.formato === "pdf" ? "%PDF-FAKE" : "PK-FAKE"}:${p.nome_arquivo}`, { status: 200 });
  }
}

export interface EnvConsumidor {
  DB: D1Database;
  ARQUIVOS: R2Bucket;
  TAREFAS: Queue;
  CONVERSA: DurableObjectNamespace<Conversa>;
  EXTRATOR: DurableObjectNamespace<ExtratorFalso>;
  DECK: DurableObjectNamespace<DeckFalso>;
  ENVIRONMENT: string;
}

export default {
  async fetch(req: Request, env: EnvConsumidor, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const [, rota, id, metodo] = url.pathname.split("/");
    if (rota === "rpc" && req.method === "POST") {
      const stub = env.CONVERSA.get(env.CONVERSA.idFromName(id)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      if (typeof stub[metodo] !== "function") return Response.json({ erro: `método ${metodo} inexistente` }, { status: 404 });
      return Response.json({ resultado: (await stub[metodo](...((await req.json()) as unknown[]))) ?? null });
    }
    if (rota === "teste" && id === "lote" && req.method === "POST") {
      const { corpo, tentativa } = (await req.json()) as { corpo: unknown; tentativa: number };
      const r: { ack: boolean; retry: { delaySeconds?: number } | null } = { ack: false, retry: null };
      const lote = { messages: [{ body: corpo, attempts: tentativa, ack: () => { r.ack = true; }, retry: (o?: { delaySeconds?: number }) => { r.retry = o ?? {}; } }] };
      await processarLote(lote as unknown as MessageBatch<unknown>, env as unknown as CloudflareEnv, ctx);
      return Response.json(r);
    }
    if (rota === "teste" && id === "enfileirar" && req.method === "POST") {
      await env.TAREFAS.send(await req.json());
      return Response.json({ ok: true });
    }
    return new Response("atlas-teste-consumidor");
  },

  async queue(lote: MessageBatch<unknown>, env: EnvConsumidor, ctx: ExecutionContext) {
    await processarLote(lote, env as unknown as CloudflareEnv, ctx);
  },
} satisfies ExportedHandler<EnvConsumidor>;
