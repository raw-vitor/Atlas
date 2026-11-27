import { env } from "@/lib/cf";
import { putAnexo } from "@/lib/rotas/anexos";

export const dynamic = "force-dynamic";

export const PUT = async (req: Request, ctx: RouteContext<"/api/conversas/[id]/anexos">) => putAnexo(req, (await ctx.params).id, env());
