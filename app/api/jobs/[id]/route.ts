import { autorizado, negado } from "@/lib/auth";
import { obter, publico } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  if (!autorizado(req)) return negado();
  const j = obter((await ctx.params).id);
  return j ? Response.json(publico(j)) : Response.json({ erro: "Job não encontrado ou expirado" }, { status: 404 });
}
