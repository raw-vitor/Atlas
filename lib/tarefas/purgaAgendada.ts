/**
 * Cron diário (wrangler: "0 6 * * *"). Seleciona em D1 as conversas sem uso há 90 dias (`apagada IS NULL AND atualizada < ?`)
 * e as purgas pendentes (`apagada IS NOT NULL`) e enfileira `{tipo: "purga"}` para cada uma, pelo mesmo caminho da exclusão manual.
 * TODO(fase2).
 */
export async function purgaAgendada(_env: CloudflareEnv, _ctx: ExecutionContext, evento: { cron: string; scheduledTime: number }): Promise<void> {
  console.log("[cron] purga agendada (stub)", { cron: evento.cron });
}
