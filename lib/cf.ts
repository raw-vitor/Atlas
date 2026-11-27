/**
 * Acesso ao ambiente do Worker (bindings e variáveis) de qualquer lugar do código.
 *
 * - Rotas do Next (OpenNext) e `next dev`: `getCloudflareContext()`. Chamado sempre sob demanda, nunca no nível do módulo.
 * - Consumidor da fila e cron (`worker.ts`): o OpenNext só inicializa o contexto no `fetch`, então esses handlers
 *   envolvem a execução em `comAmbiente(env, ctx, ...)` e `env()` devolve o que foi injetado.
 * - Testes e chamadas diretas: `env(injetado)` devolve o próprio argumento.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface Escopo {
  env: CloudflareEnv;
  ctx?: ExecutionContext;
}

const escopo = new AsyncLocalStorage<Escopo>();

/** Executa `fn` com `env` (e `ctx`) disponíveis para `env()` e `contexto()`, inclusive através de awaits e timers. */
export function comAmbiente<T>(env: CloudflareEnv, ctx: ExecutionContext | undefined, fn: () => T): T {
  return escopo.run({ env, ctx }, fn);
}

/** O `env` tipado do Worker: bindings (DB, ARQUIVOS, TAREFAS, CONVERSA, EXTRATOR, DECK) e variáveis. */
export function env(injetado?: CloudflareEnv): CloudflareEnv {
  if (injetado) return injetado;
  const e = escopo.getStore();
  if (e) return e.env;
  return getCloudflareContext().env;
}

/** O `ExecutionContext` atual (para `waitUntil`), se houver. */
export function contexto(): ExecutionContext | undefined {
  const e = escopo.getStore();
  if (e) return e.ctx;
  try {
    return getCloudflareContext().ctx;
  } catch {
    return undefined;
  }
}

/** Stub do Durable Object da conversa. O chamador precisa ter conferido antes, em D1, que a conversa é do usuário autenticado. */
export function conversaDo(conversaId: string, injetado?: CloudflareEnv) {
  const e = env(injetado);
  return e.CONVERSA.get(e.CONVERSA.idFromName(conversaId));
}
