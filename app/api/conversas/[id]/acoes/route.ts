import { autorizado, negado } from "@/lib/auth";
import { criarChatJson, novoUso } from "@/lib/bedrock";
import { obterCaso, prontidao, publicoCaso, tocar } from "@/lib/caso";
import { deckSaude } from "@/lib/deck";
import * as jobs from "@/lib/jobs";
import { deck, rascunho } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ações sem LLM no clique. Fase 1: `gerar`. */
export async function POST(req: Request, ctx: RouteContext<"/api/conversas/[id]/acoes">) {
  if (!autorizado(req)) return negado();
  const caso = obterCaso((await ctx.params).id);
  if (!caso) return Response.json({ erro: "Conversa não encontrada ou expirada." }, { status: 404 });
  let corpo: { acao?: string };
  try { corpo = await req.json(); } catch { return Response.json({ erro: "Corpo inválido." }, { status: 400 }); }

  if (corpo.acao !== "gerar") return Response.json({ erro: "Ação desconhecida." }, { status: 400 });
  if (caso.ocupado) return Response.json({ erro: "Ainda estou processando outra tarefa neste caso." }, { status: 409 });
  const pr = prontidao(caso);
  if (!pr.pronto) return Response.json({ erro: `Ainda falta: ${pr.faltas.join("; ")}.`, faltas: pr.faltas }, { status: 422 });
  // O deck-service é conferido antes de gastar chamadas ao LLM.
  const saude = await deckSaude();
  if (!saude.ok) return Response.json({ erro: `O serviço que monta o deck não está pronto (${saude.erro}). Avise o time e tente de novo.` }, { status: 503 });

  caso.ocupado = true;
  const uso = novoUso();
  const job = jobs.novo();
  const refazRascunho = !caso.rascunho;
  jobs.submeter(job, async (p) => {
    try {
      if (!caso.rascunho) await rascunho(caso, criarChatJson(uso), p, 5, 85);
      const r = await deck(caso, job.dir, ["pptx", "pdf"], uso, p);
      caso.decks.push({ jobId: job.id, versao: caso.decks.length + 1, criadoEm: Date.now() });
      return r;
    } finally { caso.ocupado = false; tocar(caso); }
  });
  return Response.json({ jobId: job.id, versao: caso.decks.length + 1, refazRascunho, caso: publicoCaso(caso) });
}
