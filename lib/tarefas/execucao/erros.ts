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

/**
 * O que vai para o log no lugar da mensagem (que pode citar arquivo e trechos do lead): a classe do erro e, quando o Bedrock respondeu
 * com erro, só o código HTTP (429 = cota, 400 = entrada grande, 5xx = indisponível). `LLMError` não define `name`, então sem isto
 * todo erro do modelo aparecia no log como "Error".
 */
export function classeDoErro(e: unknown): string {
  if (!(e instanceof Error)) return "desconhecido";
  if (e instanceof LLMError) {
    const http = /Bedrock HTTP (\d{3})/.exec(e.message);
    return http ? `LLMError HTTP ${http[1]}` : "LLMError";
  }
  return e.name;
}
