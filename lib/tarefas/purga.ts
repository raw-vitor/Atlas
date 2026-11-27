import type { ContextoTarefa } from "./contexto";
import type { MensagemTarefa } from "./tipos";

/**
 * Apaga de fato uma conversa: cancela a tarefa em andamento, remove o prefixo `u/{usuarioId}/c/{conversaId}/` do R2,
 * chama `purgar()` no DO e apaga as linhas de D1. Idempotente (a fila pode entregar de novo; o cron refaz as pendentes).
 * TODO(fase2). A ordem recomendada é R2, DO, D1: enquanto a linha de D1 existir com `apagada`, a purga é refeita se falhar no meio.
 */
export async function executarPurga(msg: Extract<MensagemTarefa, { tipo: "purga" }>, c: ContextoTarefa): Promise<void> {
  console.log("[tarefa] purga recebida (stub)", { conversaId: msg.conversaId, tentativa: c.tentativa });
}
