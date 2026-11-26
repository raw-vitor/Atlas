import { autorizado, negado } from "@/lib/auth";
import { novoCaso, publicoCaso } from "@/lib/caso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!autorizado(req)) return negado();
  const c = novoCaso();
  return Response.json({ id: c.id, caso: publicoCaso(c) });
}
