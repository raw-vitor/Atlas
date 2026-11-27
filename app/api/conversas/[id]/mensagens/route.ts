import { env } from "@/lib/cf";
import { getMensagens, postMensagens } from "@/lib/rotas/mensagens";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/conversas/[id]/mensagens">;

export const GET = async (req: Request, ctx: Ctx) => getMensagens(req, (await ctx.params).id, env());
export const POST = async (req: Request, ctx: Ctx) => postMensagens(req, (await ctx.params).id, env());
