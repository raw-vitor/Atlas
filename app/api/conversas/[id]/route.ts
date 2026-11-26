import { autorizado, negado } from "@/lib/auth";
import { obterCaso, publicoCaso } from "@/lib/caso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/conversas/[id]">) {
  if (!autorizado(req)) return negado();
  const c = obterCaso((await ctx.params).id);
  if (!c) return Response.json({ erro: "Conversa não encontrada ou expirada" }, { status: 404 });
  return Response.json(publicoCaso(c));
}
