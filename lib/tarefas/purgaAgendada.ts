import { listarInativas, listarPendentesPurga, marcarApagadaSeInativa } from "../db/conversas";
import type { MensagemTarefa } from "./tipos";

/** Conversa sem uso por este tempo é purgada por inteiro (plano, decisão D1). `atualizada` muda a cada mensagem e a cada tarefa. */
export const RETENCAO_DIAS = 90;
/** Tamanho de cada consulta e de cada `sendBatch` (limite da fila: 100 mensagens por lote). */
export const LOTE = 100;
/** Teto por execução, para o cron não monopolizar a fila; o que sobrar fica para o dia seguinte. */
export const MAX_POR_EXECUCAO = 1000;
/** Purga pendente só é reenfileirada pelo cron depois deste tempo: antes disso ainda deve estar na fila. */
export const ESPERA_PENDENTE_MS = 60 * 60_000;

const DIA_MS = 86_400_000;

async function enfileirar(env: CloudflareEnv, conversas: { id: string; usuarioId: string }[]): Promise<void> {
  for (let i = 0; i < conversas.length; i += LOTE) {
    const mensagens = conversas.slice(i, i + LOTE).map((c) => ({ body: { tipo: "purga", conversaId: c.id, usuarioId: c.usuarioId } satisfies MensagemTarefa }));
    await env.TAREFAS.sendBatch(mensagens);
  }
}

/**
 * Cron diário (wrangler: "0 6 * * *"). Pelo mesmo caminho da exclusão manual (`{tipo: "purga"}` na fila):
 *   1. refaz as purgas pendentes (`apagada IS NOT NULL` há mais de 1 hora: o envio falhou ou o consumidor esgotou as tentativas);
 *   2. marca como apagadas as conversas com `atualizada` anterior a agora - 90 dias e as enfileira. A marca reconfere `atualizada`, então
 *      uma conversa que o assessor reabriu entre a consulta e a marca fica.
 * Em lotes de 100, até `MAX_POR_EXECUCAO` de cada tipo. `agora` existe só para testes.
 */
export async function purgaAgendada(
  env: CloudflareEnv,
  _ctx: ExecutionContext,
  evento: { cron: string; scheduledTime: number },
  agora: number = evento.scheduledTime || Date.now(),
): Promise<{ pendentes: number; inativas: number }> {
  const pendentes = await listarPendentesPurga(env, MAX_POR_EXECUCAO, agora - ESPERA_PENDENTE_MS);
  await enfileirar(env, pendentes);

  const limite = agora - RETENCAO_DIAS * DIA_MS;
  let inativas = 0;
  while (inativas < MAX_POR_EXECUCAO) {
    const lote = await listarInativas(env, limite, LOTE);
    if (!lote.length) break;
    const marcadas: typeof lote = [];
    for (const c of lote) if (await marcarApagadaSeInativa(env, c.id, limite)) marcadas.push(c);
    await enfileirar(env, marcadas);
    inativas += marcadas.length;
    // Se nada foi marcado, todas voltaram a ser usadas entre a consulta e a marca; a próxima consulta já não as traz.
    if (lote.length < LOTE) break;
  }
  console.log("[cron] purga agendada", { cron: evento.cron, pendentes: pendentes.length, inativas });
  return { pendentes: pendentes.length, inativas };
}
