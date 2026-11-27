/**
 * Sobe o Worker de teste (tests/workers/wrangler.test.jsonc) no runtime local do wrangler (workerd/Miniflare) pelo
 * `createTestHarness`. Cada arquivo de teste cria o seu servidor; o armazenamento é temporário e `reset()` o recria.
 * Roda com `npm run test:workers` (precisa do pacote wrangler; não precisa de Docker nem do build do OpenNext).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import type { EnvTeste } from "./entry";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type Servidor = ReturnType<typeof criarServidor>;

export function criarServidor() {
  const server = createTestHarness({
    root: raiz,
    workers: [{ configPath: "tests/workers/wrangler.test.jsonc" }],
  });
  const worker = server.getWorker<EnvTeste>();
  // Os tipos genéricos do wrangler para estes dois métodos brigam com o lib "dom" do projeto; aqui o formato é fixo.
  const avancado = worker as unknown as {
    evictDurableObject(classe: string, id: { name: string }): Promise<void>;
    getDurableObjectStorage(classe: string, id: { name: string }): Promise<{ exec(sql: string, ...bind: unknown[]): Promise<unknown[]> }>;
  };

  /** Chama um método RPC do Durable Object da conversa, de dentro do Worker (é o caminho real das rotas). */
  async function rpc<T = unknown>(conversaId: string, metodo: string, ...args: unknown[]): Promise<T> {
    const r = await server.fetch(`/rpc/${conversaId}/${metodo}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const corpo = (await r.json()) as { resultado?: T; erro?: string };
    if (!r.ok) throw new Error(corpo.erro ?? `RPC ${metodo} falhou (${r.status})`);
    return corpo.resultado as T;
  }

  /** Abre o SSE e devolve um leitor que acumula os quadros recebidos. */
  async function abrirSse(conversaId: string, lastEventId?: number) {
    const ac = new AbortController();
    const r = await server.fetch(`/sse/${conversaId}`, {
      headers: lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) },
      signal: ac.signal,
    });
    if (!r.ok || !r.body) throw new Error(`SSE respondeu ${r.status}`);
    const leitor = r.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    const quadros: { id?: number; evento?: string; dados?: unknown; comentario?: string }[] = [];
    const bomba = (async () => {
      try {
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) return;
          buffer += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buffer.indexOf("\n\n")) >= 0) {
            const bloco = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const q: (typeof quadros)[number] = {};
            for (const linha of bloco.split("\n")) {
              if (linha.startsWith(":")) q.comentario = linha.slice(1).trim();
              else if (linha.startsWith("id: ")) q.id = Number(linha.slice(4));
              else if (linha.startsWith("event: ")) q.evento = linha.slice(7);
              else if (linha.startsWith("data: ")) q.dados = JSON.parse(linha.slice(6));
            }
            if (q.evento || q.comentario) quadros.push(q);
          }
        }
      } catch { /* cancelado pelo teste */ }
    })();
    return {
      quadros,
      eventos: () => quadros.filter((q) => q.evento).map((q) => q.evento!),
      fechar: async () => { ac.abort(); await leitor.cancel().catch(() => undefined); await bomba; },
      /** Espera até `n` quadros com evento (ou estoura o prazo). */
      async esperar(n: number, ms = 5000) {
        const fim = Date.now() + ms;
        while (quadros.filter((q) => q.evento).length < n) {
          if (Date.now() > fim) throw new Error(`Esperava ${n} eventos, chegaram ${JSON.stringify(quadros)}`);
          await new Promise((res) => setTimeout(res, 20));
        }
      },
      /** O corpo terminou (o servidor fechou o stream)? */
      terminou: () => bomba.then(() => true),
    };
  }

  /** Executa SQL dentro do Durable Object (para inspecionar ou envelhecer o estado sem relógio falso). */
  const sql = async (conversaId: string) => (await avancado.getDurableObjectStorage("Conversa", { name: conversaId })).exec;
  /** Tira a instância do DO da memória (como a Cloudflare faz ao ficar ociosa); o armazenamento permanece. */
  const evictar = (conversaId: string) => avancado.evictDurableObject("Conversa", { name: conversaId });

  return { server, worker, rpc, abrirSse, sql, evictar };
}

let seq = 0;
/** Id de conversa único por teste (32 hex, como em produção). */
export const novoId = () => `${Date.now().toString(16).padStart(12, "0")}${(seq++).toString(16).padStart(4, "0")}`.padEnd(32, "0");
