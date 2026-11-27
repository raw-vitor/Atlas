import type { ContextoTarefa } from "./contexto";
import type { MensagemTarefa } from "./tipos";

/**
 * Executa um turno de conversa (mensagem com ou sem anexos).
 * TODO(fase2/3): comecarTarefa no DO -> carregar caso e fontes -> leitura/interpretar/responder -> gravar mensagem em D1 ->
 * salvarCaso(caso, {tarefaId}) -> terminarTarefa. Com batimento a cada poucos segundos para ver o cancelamento.
 * Enquanto for stub, a tarefa criada por `iniciarTarefa` fica na fila até o lease do DO expirar.
 */
export async function executarTurno(msg: Extract<MensagemTarefa, { tipo: "turno" }>, c: ContextoTarefa): Promise<void> {
  console.log("[tarefa] turno recebido (stub)", { conversaId: msg.conversaId, tarefaId: msg.tarefaId, tentativa: c.tentativa });
}
