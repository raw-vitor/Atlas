import { autorizado, negado } from "@/lib/auth";
import { ping } from "@/lib/bedrock";
import { deckSaude } from "@/lib/deck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!autorizado(req)) return negado();
  const [bedrock, deck] = await Promise.all([ping(), deckSaude()]);
  return Response.json({ ok: bedrock.ok && deck.ok, bedrock, deck }, { status: bedrock.ok && deck.ok ? 200 : 503 });
}
