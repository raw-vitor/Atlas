/**
 * Entry do Worker de teste (tests/workers/wrangler.test.jsonc). Expõe, por HTTP, o que os testes precisam exercitar dentro do
 * runtime do Worker: chamadas RPC ao Durable Object `Conversa` e o consumidor real da fila (`processarLote`).
 *   POST /rpc/{conversaId}/{metodo}   corpo: JSON com a lista de argumentos   ->  { resultado }
 *   GET  /sse/{conversaId}            (Last-Event-ID opcional)                ->  text/event-stream
 *   /api/...                          as rotas reais de lib/rotas (mesmas funções que app/api/** chama), com o env de teste
 *   POST /teste/cron                  roda `purgaAgendada` ({agora?} opcional)    ->  { pendentes, inativas }
 *   GET  /teste/fila                  mensagens que as rotas enviaram à fila de turno/deck (não são consumidas)
 *
 * Nas rotas, `TAREFAS` é um invólucro: mensagens `turno` e `deck` só são registradas (o consumidor delas é de outra área e chamaria o
 * Bedrock); `purga` vai para a fila real e é executada por `processarLote` (purga de verdade). Cabeçalhos de teste:
 *   x-teste-fila: falha          o envio à fila de turno/deck lança
 *   x-teste-deck: fora | schema  o Container do deck não responde / responde com outro schema
 *   x-teste-ambiente: production simula ENVIRONMENT=production
 *   x-teste-jwks: {"keys":[...]}  chaves públicas com que o verificador do Access confere o JWT (o teste gera o par na hora);
 *                                 sem ele, o verificador é o padrão e busca as chaves na rede (que não existe nos testes: 401)
 */
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import { Conversa } from "../../workers/conversa";
import { definirVerificadorAcesso, verificadorAccess } from "../../lib/auth";
import { processarLote, purgaAgendada } from "../../lib/tarefas";
import constantes from "../../lib/schemas/constantes.json";
import { putAnexo } from "../../lib/rotas/anexos";
import { postAcoes } from "../../lib/rotas/acoes";
import { getEventos, postCancelar } from "../../lib/rotas/controle";
import { deleteConversa, getConversa, getConversas, patchConversa, postConversas } from "../../lib/rotas/conversas";
import { deleteConfigPrompt, getConfigPrompt, putConfigPrompt } from "../../lib/rotas/configPrompt";
import { getDeck } from "../../lib/rotas/decks";
import { getMensagens, postMensagens } from "../../lib/rotas/mensagens";

export { Conversa };

// O verificador real do Access, com as chaves vindas do cabeçalho `x-teste-jwks` da própria requisição (sem estado compartilhado
// entre requisições). Só este Worker de teste faz isso; o de produção usa `verificadorAccess()` com as chaves do team domain.
const verificadorPadrao = verificadorAccess();
definirVerificadorAcesso({
  verificar(req, e) {
    const jwks = req.headers.get("x-teste-jwks");
    if (!jwks) return verificadorPadrao.verificar(req, e);
    return verificadorAccess(() => createLocalJWKSet(JSON.parse(jwks) as JSONWebKeySet)).verificar(req, e);
  },
});

export interface EnvTeste {
  DB: D1Database;
  ARQUIVOS: R2Bucket;
  TAREFAS: Queue;
  CONVERSA: DurableObjectNamespace<Conversa>;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  MAX_UPLOAD_MB?: string;
}

/** Mensagens de turno/deck que as rotas enviaram. Vive no isolate do Worker de teste. */
const enviadas: unknown[] = [];

function ambienteDeRota(req: Request, env: EnvTeste): CloudflareEnv {
  const falhaFila = req.headers.get("x-teste-fila") === "falha";
  const deck = req.headers.get("x-teste-deck");
  const tarefas = {
    async send(msg: { tipo: string }) {
      if (msg.tipo === "purga") return env.TAREFAS.send(msg);
      if (falhaFila) throw new Error("fila indisponível");
      enviadas.push(msg);
    },
    async sendBatch(lote: { body: { tipo: string } }[]) {
      for (const m of lote) await this.send(m.body);
    },
  };
  const containerDeck = {
    idFromName: (n: string) => n,
    get: () => ({
      async fetch() {
        if (deck === "fora") throw new Error("container indisponível");
        return Response.json({ ok: true, schema_hash: deck === "schema" ? "outro" : constantes.SCHEMA_HASH });
      },
    }),
  };
  const ambiente = req.headers.get("x-teste-ambiente") ?? env.ENVIRONMENT;
  return { ...env, ENVIRONMENT: ambiente, TAREFAS: tarefas, DECK: containerDeck } as unknown as CloudflareEnv;
}

type Manipulador = (req: Request, e: CloudflareEnv, p: string[]) => Promise<Response>;

/** Mesma tabela de métodos e caminhos de app/api/**. */
const ROTAS: { metodo: string; padrao: RegExp; fn: Manipulador }[] = [
  { metodo: "GET", padrao: /^\/api\/configuracoes\/prompt$/, fn: (r, e) => getConfigPrompt(r, e) },
  { metodo: "PUT", padrao: /^\/api\/configuracoes\/prompt$/, fn: (r, e) => putConfigPrompt(r, e) },
  { metodo: "DELETE", padrao: /^\/api\/configuracoes\/prompt$/, fn: (r, e) => deleteConfigPrompt(r, e) },
  { metodo: "GET", padrao: /^\/api\/conversas$/, fn: (r, e) => getConversas(r, e) },
  { metodo: "POST", padrao: /^\/api\/conversas$/, fn: (r, e) => postConversas(r, e) },
  { metodo: "GET", padrao: /^\/api\/conversas\/([^/]+)$/, fn: (r, e, p) => getConversa(r, p[0], e) },
  { metodo: "PATCH", padrao: /^\/api\/conversas\/([^/]+)$/, fn: (r, e, p) => patchConversa(r, p[0], e) },
  { metodo: "DELETE", padrao: /^\/api\/conversas\/([^/]+)$/, fn: (r, e, p) => deleteConversa(r, p[0], e) },
  { metodo: "GET", padrao: /^\/api\/conversas\/([^/]+)\/mensagens$/, fn: (r, e, p) => getMensagens(r, p[0], e) },
  { metodo: "POST", padrao: /^\/api\/conversas\/([^/]+)\/mensagens$/, fn: (r, e, p) => postMensagens(r, p[0], e) },
  { metodo: "PUT", padrao: /^\/api\/conversas\/([^/]+)\/anexos$/, fn: (r, e, p) => putAnexo(r, p[0], e) },
  { metodo: "POST", padrao: /^\/api\/conversas\/([^/]+)\/acoes$/, fn: (r, e, p) => postAcoes(r, p[0], e) },
  { metodo: "POST", padrao: /^\/api\/conversas\/([^/]+)\/cancelar$/, fn: (r, e, p) => postCancelar(r, p[0], e) },
  { metodo: "GET", padrao: /^\/api\/conversas\/([^/]+)\/eventos$/, fn: (r, e, p) => getEventos(r, p[0], e) },
  { metodo: "GET", padrao: /^\/api\/conversas\/([^/]+)\/decks\/([^/]+)$/, fn: (r, e, p) => getDeck(r, p[0], p[1], e) },
];

export default {
  async fetch(req: Request, env: EnvTeste): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      for (const r of ROTAS) {
        const m = r.padrao.exec(url.pathname);
        if (m && r.metodo === req.method) return r.fn(req, ambienteDeRota(req, env), m.slice(1));
      }
      return Response.json({ erro: "rota inexistente" }, { status: 404 });
    }
    if (url.pathname === "/teste/fila") return Response.json(enviadas);
    if (url.pathname === "/teste/cron" && req.method === "POST") {
      const { agora } = (await req.json().catch(() => ({}))) as { agora?: number };
      const r = await purgaAgendada(ambienteDeRota(req, env), {} as ExecutionContext, { cron: "teste", scheduledTime: agora ?? Date.now() });
      return Response.json(r);
    }
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
