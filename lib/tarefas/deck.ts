import type { ContextoTarefa } from "./contexto";
import type { MensagemTarefa } from "./tipos";

/**
 * Gera o deck: monta o payload, chama o Container `DECK`, grava v{n}.pptx/.pdf em R2 e a mensagem `resultado` em D1.
 * TODO(fase4).
 */
export async function executarDeck(msg: Extract<MensagemTarefa, { tipo: "deck" }>, c: ContextoTarefa): Promise<void> {
  console.log("[tarefa] deck recebido (stub)", { conversaId: msg.conversaId, tarefaId: msg.tarefaId, tentativa: c.tentativa });
}
