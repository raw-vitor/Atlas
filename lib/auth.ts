import crypto from "node:crypto";

/** Autenticação simples opcional: se ATLAS_ACCESS_TOKEN estiver definido, toda rota /api exige o token. */
export function autorizado(req: Request): boolean {
  const esperado = (process.env.ATLAS_ACCESS_TOKEN ?? "").trim();
  if (!esperado) return true;
  const cookie = /(?:^|;\s*)atlas_token=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  const dado = req.headers.get("x-atlas-token") ?? (cookie ? decodeURIComponent(cookie) : "");
  const a = Buffer.from(dado), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const negado = () => Response.json({ erro: "Acesso negado" }, { status: 401 });
