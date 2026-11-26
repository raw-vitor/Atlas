import fs from "node:fs";
import path from "node:path";
import { autorizado, negado } from "@/lib/auth";
import { obter } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/download">) {
  if (!autorizado(req)) return negado();
  const j = obter((await ctx.params).id);
  const fmt = new URL(req.url).searchParams.get("fmt") ?? "pptx";
  const nome = j?.status === "pronto" ? j.resultado?.arquivos[fmt] : undefined;
  if (!j || !nome || !MIME[fmt]) return Response.json({ erro: "Arquivo indisponível" }, { status: 404 });
  const dados = fs.readFileSync(path.join(j.dir, path.basename(nome)));
  return new Response(new Uint8Array(dados), {
    headers: { "Content-Type": MIME[fmt], "Content-Disposition": `attachment; filename="${nome}"`, "Content-Length": String(dados.length) },
  });
}
