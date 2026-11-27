/**
 * Snapshot da configuração de prompt do assessor para uma tarefa. Os consumidores leem uma vez no início: a mesma config vale até o
 * fim, mesmo que o assessor salve outra versão no meio. Filtra sempre por `usuarioId` (vem da mensagem da fila, dono já conferido).
 */
import { lerConfigPrompt } from "../../db/configPrompt";
import { configVazia, type ConfigPrompt } from "../../prompt-tipos";

/**
 * Falha ao ler (D1 fora do ar, por exemplo): segue com o prompt original e registra o erro, sem conteúdo do lead. O assessor não pode
 * ficar sem deck por causa disso. Seguir com `configVazia()` (versão 0) também deixa o caso honesto: ele grava que foi gerado com
 * o original, então, se a config real do assessor for outra versão, o alerta de "versão anterior" aparece.
 */
export async function configDaTarefa(e: CloudflareEnv, usuarioId: string, rotulo: string): Promise<ConfigPrompt> {
  try {
    return await lerConfigPrompt(e, usuarioId);
  } catch (x) {
    console.error(`[${rotulo}] não li a config de prompt; sigo com o prompt original`, { erro: x instanceof Error ? x.name : "desconhecido" });
    return configVazia();
  }
}
