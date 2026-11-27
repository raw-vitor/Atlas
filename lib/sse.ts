/** Resposta SSE a partir de uma função que recebe `enviar(evento, dados)`. Fecha o fluxo ao terminar. */
import { CanceladoError, comCancelamento } from "./cancelamento";

export type Enviar = (evento: string, dados: unknown) => void;

/**
 * Se o cliente fechar a conexão (cancelar o fetch), o sinal de cancelamento dispara e as chamadas ao LLM em andamento são abortadas.
 * `fn` roda dentro do contexto de cancelamento.
 */
export function respostaSSE(fn: (enviar: Enviar, signal: AbortSignal) => Promise<void>, reqSignal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const ac = new AbortController();
  reqSignal?.addEventListener("abort", () => ac.abort(), { once: true });
  const stream = new ReadableStream({
    async start(ctrl) {
      let aberto = true;
      const enviar: Enviar = (evento, dados) => {
        if (aberto) { try { ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`)); } catch { aberto = false; } }
      };
      try { await comCancelamento(ac.signal, () => fn(enviar, ac.signal)); }
      catch (e) {
        if (e instanceof CanceladoError || ac.signal.aborted) console.error("[atlas] fluxo cancelado pelo assessor");
        else {
          console.error(`[atlas] erro no fluxo: ${e instanceof Error ? e.message.slice(0, 300) : "desconhecido"}`);
          enviar("erro", { mensagem: e instanceof Error ? e.message : "Algo deu errado." });
        }
      } finally { aberto = false; try { ctrl.close(); } catch {} }
    },
    cancel() { ac.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
