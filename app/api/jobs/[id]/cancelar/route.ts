import { autorizado, negado } from "@/lib/auth";
import { cancelar, obter } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancela a geração do deck. Se o job já terminou, não faz nada e informa o status atual. */
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/cancelar">) {
  if (!autorizado(req)) return negado();
  const j = obter((await ctx.params).id);
  if (!j) return Response.json({ erro: "Job não encontrado ou expirado" }, { status: 404 });
  return Response.json({ cancelando: cancelar(j), status: j.status });
}
