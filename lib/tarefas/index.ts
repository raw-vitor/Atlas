/** Despacho das mensagens de `atlas-tarefas` para as funções de cada tipo. Sem dependência do runtime do Worker, para testar em Node. */
import { comAmbiente } from "../cf";
import type { ContextoTarefa } from "./contexto";
import { executarDeck } from "./deck";
import { executarPurga } from "./purga";
import { executarTurno } from "./turno";
import { TIPOS_FILA, type MensagemTarefa } from "./tipos";

export { purgaAgendada } from "./purgaAgendada";

/** Segundos de espera antes da reentrega: 10, 20, 40, ... até 5 min. */
export const esperaReentrega = (tentativa: number) => Math.min(300, 10 * 2 ** Math.max(0, tentativa - 1));

function mensagemValida(corpo: unknown): corpo is MensagemTarefa {
  if (!corpo || typeof corpo !== "object") return false;
  const m = corpo as Record<string, unknown>;
  if (!TIPOS_FILA.includes(m.tipo as (typeof TIPOS_FILA)[number])) return false;
  if (typeof m.conversaId !== "string" || !m.conversaId || typeof m.usuarioId !== "string" || !m.usuarioId) return false;
  return m.tipo === "purga" || (typeof m.tarefaId === "string" && m.tarefaId.length > 0);
}

/** Executa uma mensagem. Lança se o corpo for inválido ou a função falhar (o chamador decide entre ack e retry). */
export async function despachar(corpo: unknown, c: ContextoTarefa): Promise<void> {
  if (!mensagemValida(corpo)) throw new Error("Mensagem de tarefa inválida");
  switch (corpo.tipo) {
    case "turno": return executarTurno(corpo, c);
    case "deck": return executarDeck(corpo, c);
    case "purga": return executarPurga(corpo, c);
  }
}

/**
 * Handler `queue` do Worker. Uma mensagem por vez (`max_batch_size = 1`, mas o laço vale para qualquer tamanho): sucesso dá ack;
 * falha pede reentrega com espera crescente; depois de `max_retries` a fila manda a mensagem para `atlas-tarefas-mortas`.
 * O log leva o tipo, o id da conversa e a classe do erro, nunca o conteúdo do lead.
 */
export async function processarLote(lote: MessageBatch<unknown>, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
  for (const m of lote.messages) {
    try {
      await comAmbiente(env, ctx, () => despachar(m.body, { env, ctx, tentativa: m.attempts }));
      m.ack();
    } catch (e) {
      const corpo = m.body as Partial<MensagemTarefa> | null;
      console.error("[tarefa] falhou", {
        tipo: corpo?.tipo,
        conversaId: corpo?.conversaId,
        tentativa: m.attempts,
        erro: e instanceof Error ? e.name : "desconhecido",
      });
      m.retry({ delaySeconds: esperaReentrega(m.attempts) });
    }
  }
}
