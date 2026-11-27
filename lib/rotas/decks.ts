/** `GET /api/conversas/{id}/decks/{versao}?fmt=pptx|pdf`: o arquivo do R2, depois de conferir o dono em D1. */
import { chaveDeck } from "../r2";
import { autenticarConversa, ehResposta, erro, protegida } from "./comum";

const TIPOS = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
} as const;

export function getDeck(req: Request, id: string, versao: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("decks.GET", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const fmt = new URL(req.url).searchParams.get("fmt") ?? "pptx";
    if (fmt !== "pptx" && fmt !== "pdf") return erro("Formato inválido. Use pptx ou pdf.", 400);
    if (!/^[1-9]\d{0,3}$/.test(versao)) return erro("Versão inválida.", 400);
    const n = Number(versao);
    const objeto = await a.env.ARQUIVOS.get(chaveDeck(a.usuario.id, a.conversa.id, n, fmt));
    if (!objeto) return erro("Esse deck não existe nesta conversa.", 404);
    return new Response(objeto.body, {
      headers: {
        "content-type": TIPOS[fmt],
        "content-length": String(objeto.size),
        "content-disposition": `attachment; filename="atlas-deck-v${n}.${fmt}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
