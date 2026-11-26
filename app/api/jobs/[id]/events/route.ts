import { autorizado, negado } from "@/lib/auth";
import { obter, type Evento } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/events">) {
  if (!autorizado(req)) return negado();
  const j = obter((await ctx.params).id);
  if (!j) return Response.json({ erro: "Job não encontrado ou expirado" }, { status: 404 });

  const enc = new TextEncoder();
  let fechar = () => {};
  const stream = new ReadableStream({
    start(ctrl) {
      let encerrado = false;
      const enviar = (e: Evento) => {
        if (encerrado) return;
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        if (e.status === "pronto" || e.status === "erro") fim();
      };
      const batida = setInterval(() => !encerrado && ctrl.enqueue(enc.encode(": ping\n\n")), 15000);
      const fim = () => { if (encerrado) return; encerrado = true; clearInterval(batida); j.ouvintes.delete(enviar); try { ctrl.close(); } catch {} };
      fechar = fim;
      j.eventos.forEach(enviar);          // histórico, para quem reconectou
      if (!encerrado) j.ouvintes.add(enviar);
    },
    cancel() { fechar(); },
  });
  req.signal.addEventListener("abort", () => fechar());
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
