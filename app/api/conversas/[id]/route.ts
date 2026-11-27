import { env } from "@/lib/cf";
import { deleteConversa, getConversa, patchConversa } from "@/lib/rotas/conversas";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/conversas/[id]">;

export const GET = async (req: Request, ctx: Ctx) => getConversa(req, (await ctx.params).id, env());
export const PATCH = async (req: Request, ctx: Ctx) => patchConversa(req, (await ctx.params).id, env());
export const DELETE = async (req: Request, ctx: Ctx) => deleteConversa(req, (await ctx.params).id, env());
