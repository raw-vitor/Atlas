import { env } from "@/lib/cf";
import { postCancelar } from "@/lib/rotas/controle";

export const dynamic = "force-dynamic";

export const POST = async (req: Request, ctx: RouteContext<"/api/conversas/[id]/cancelar">) => postCancelar(req, (await ctx.params).id, env());
