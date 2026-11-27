/** Erros das tarefas do consumidor e a tradução deles para a mensagem que o assessor lê. */
import { LLMError } from "../../bedrock";

/** Falha com mensagem já pronta para a tela (anexo ilegível, formato recusado, caso incompleto). */
export class ErroDeTarefa extends Error { constructor(mensagem: string) { super(mensagem); this.name = "ErroDeTarefa"; } }

export const MSG_ERRO_GENERICO = "Algo deu errado do nosso lado. Nada foi alterado na conversa. Tente de novo em instantes.";
export const MSG_ERRO_MODELO = "Não consegui falar com o modelo agora. Nada foi alterado na conversa. Tente de novo em instantes.";

/**
 * Mensagem para a tela. Não repassa erro interno (TypeError e afins) nem o texto cru do Bedrock; repassa o das falhas de domínio, que
 * o código lança em português (`new Error("Faltam a carteira...")`, 422 do deck-service) e o de `ErroDeTarefa`.
 */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroDeTarefa) return e.message;
  if (e instanceof LLMError) return MSG_ERRO_MODELO;
  if (e instanceof Error && e.constructor === Error && e.message.trim()) return e.message.slice(0, 300);
  return MSG_ERRO_GENERICO;
}
