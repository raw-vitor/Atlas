import { env } from "@/lib/cf";
import { getDeck } from "@/lib/rotas/decks";

export const dynamic = "force-dynamic";

export const GET = async (req: Request, ctx: RouteContext<"/api/conversas/[id]/decks/[versao]">) => {
  const { id, versao } = await ctx.params;
  return getDeck(req, id, versao, env());
};
