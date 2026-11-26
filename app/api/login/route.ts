import crypto from "node:crypto";

export const runtime = "nodejs";

/** Troca o token de acesso por um cookie httpOnly (só vale se ATLAS_ACCESS_TOKEN estiver definido). */
export async function POST(req: Request) {
  const esperado = (process.env.ATLAS_ACCESS_TOKEN ?? "").trim();
  if (!esperado) return Response.json({ ok: true });
  const { token = "" } = (await req.json().catch(() => ({}))) as { token?: string };
  const a = Buffer.from(String(token)), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return Response.json({ erro: "Token inválido" }, { status: 401 });
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `atlas_token=${encodeURIComponent(esperado)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${process.env.NODE_ENV === "production" && process.env.ATLAS_COOKIE_SECURE === "1" ? "; Secure" : ""}`,
    },
  });
}
