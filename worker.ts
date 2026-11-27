/**
 * Entry do Worker "atlas" (wrangler.jsonc: main). Reaproveita o `fetch` gerado pelo OpenNext (`npm run preview` e o build
 * geram `.open-next/worker.js`) e acrescenta o que o OpenNext não gera: consumidor da fila, cron e as classes de DO/Container.
 * Guia: https://opennext.js.org/cloudflare/howtos/custom-worker
 */
import openNext from "./.open-next/worker.js";
import { processarLote, purgaAgendada } from "./lib/tarefas";

export { Conversa } from "./workers/conversa";
export { Extrator, DeckService } from "./workers/containers";
// O OpenNext também exporta DOQueueHandler, DOShardedTagCache e BucketCachePurge; só seriam necessários com cache incremental
// em Durable Objects, que o Atlas não usa (open-next.config.ts).

export default {
  fetch: openNext.fetch,

  async queue(lote, env, ctx) {
    await processarLote(lote, env, ctx);
  },

  async scheduled(evento, env, ctx) {
    await purgaAgendada(env, ctx, { cron: evento.cron, scheduledTime: evento.scheduledTime });
  },
} satisfies ExportedHandler<CloudflareEnv>;
