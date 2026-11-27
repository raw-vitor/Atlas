import { env } from "@/lib/cf";
import { getEventos } from "@/lib/rotas/controle";

export const dynamic = "force-dynamic";

export const GET = async (req: Request, ctx: RouteContext<"/api/conversas/[id]/eventos">) => getEventos(req, (await ctx.params).id, env());
