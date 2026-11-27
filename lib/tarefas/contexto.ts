/** O que o consumidor entrega a cada função de `lib/tarefas/`. */
export interface ContextoTarefa {
  env: CloudflareEnv;
  ctx: ExecutionContext;
  /** `message.attempts` da fila: 1 na primeira entrega. Passe a `comecarTarefa` do DO para distinguir duplicata de reentrega. */
  tentativa: number;
}
