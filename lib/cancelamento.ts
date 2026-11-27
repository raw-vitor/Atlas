/** Cancelamento de um fluxo em andamento (envio de mensagem ou geração do deck). */
import { AsyncLocalStorage } from "node:async_hooks";

/** O assessor cancelou o processo. Nunca é retentável nem vira mensagem de erro para o usuário. */
export class CanceladoError extends Error { constructor() { super("Cancelado pelo assessor"); this.name = "CanceladoError"; } }

/** Sinal do fluxo em andamento. Quem inicia o fluxo chama `comCancelamento`; as chamadas ao LLM e ao deck o leem daqui. */
const contexto = new AsyncLocalStorage<AbortSignal>();
export const comCancelamento = <T,>(signal: AbortSignal, fn: () => T): T => contexto.run(signal, fn);
export const sinalAtual = () => contexto.getStore();
export function checarCancelado() { if (contexto.getStore()?.aborted) throw new CanceladoError(); }

/** setTimeout que termina com CanceladoError se o fluxo for cancelado durante a espera. */
export const esperar = (ms: number) => new Promise<void>((resolve, reject) => {
  const sinal = contexto.getStore();
  if (sinal?.aborted) return reject(new CanceladoError());
  const cancelar = () => { clearTimeout(t); reject(new CanceladoError()); };
  const t = setTimeout(() => { sinal?.removeEventListener("abort", cancelar); resolve(); }, ms);
  sinal?.addEventListener("abort", cancelar, { once: true });
});
