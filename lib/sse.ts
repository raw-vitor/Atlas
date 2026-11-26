/** Resposta SSE a partir de uma função que recebe `enviar(evento, dados)`. Fecha o fluxo ao terminar. */
export type Enviar = (evento: string, dados: unknown) => void;

export function respostaSSE(fn: (enviar: Enviar) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let aberto = true;
      const enviar: Enviar = (evento, dados) => {
        if (aberto) ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));
      };
      try { await fn(enviar); }
      catch (e) {
        console.error(`[atlas] erro no fluxo: ${e instanceof Error ? e.message.slice(0, 300) : "desconhecido"}`);
        enviar("erro", { mensagem: e instanceof Error ? e.message : "Algo deu errado." });
      } finally { aberto = false; try { ctrl.close(); } catch {} }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
