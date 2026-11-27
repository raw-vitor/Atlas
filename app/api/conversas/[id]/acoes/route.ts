import { env } from "@/lib/cf";
import { postAcoes } from "@/lib/rotas/acoes";

export const dynamic = "force-dynamic";

export const POST = async (req: Request, ctx: RouteContext<"/api/conversas/[id]/acoes">) => postAcoes(req, (await ctx.params).id, env());
