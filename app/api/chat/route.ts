import { autorizado, negado } from "@/lib/auth";
import { criarChatJson, novoUso } from "@/lib/bedrock";
import { interpretar } from "@/lib/chat";
import { config } from "@/lib/config";
import { deckSaude } from "@/lib/deck";
import * as jobs from "@/lib/jobs";
import { MAX_ARQUIVOS, MAX_LOTE_MB } from "@/lib/formatos";
import { rodar } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!autorizado(req)) return negado();
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ reply: "Não consegui ler o envio. Tente anexar de novo." }, { status: 400 }); }
  const msg = String(form.get("message") ?? "");
  const arquivos = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (arquivos.length > MAX_ARQUIVOS) return Response.json({ reply: `Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.` }, { status: 400 });
  for (const f of arquivos)
    if (f.size > config.maxUploadMb * 1024 * 1024) return Response.json({ reply: `"${f.name}" passa de ${config.maxUploadMb} MB.` }, { status: 413 });

  if (arquivos.reduce((t, f) => t + f.size, 0) > MAX_LOTE_MB * 1024 * 1024)
    return Response.json({ reply: `O envio passa de ${MAX_LOTE_MB} MB no total.` }, { status: 413 });

  // Antes de enviar qualquer texto ou arquivo à LLM, confirma que o serviço que monta o deck está no ar.
  const saude = await deckSaude();
  if (!saude.ok)
    return Response.json({ reply: `O serviço que monta o deck não está pronto (${saude.erro}). Não enviei nada para análise. Avise o time e tente de novo.` }, { status: 503 });

  const declarados: Record<string, "carteira" | "transcricao"> = {};
  for (const [k, v] of form.entries())
    if (k.startsWith("papel:") && (v === "carteira" || v === "transcricao")) declarados[k.slice(6)] = v;

  const uso = novoUso();
  let it;
  try {
    const bufs = await Promise.all(arquivos.map(async (f) => ({ nome: f.name, buf: Buffer.from(await f.arrayBuffer()) })));
    it = await interpretar(msg, bufs, uso, declarados);
  } catch (e) {
    return Response.json({ reply: e instanceof Error ? e.message : "Erro ao ler os anexos." }, { status: 422 });
  }
  if (it.pergunta || !it.carteiras.length || !it.transcricoes.length) return Response.json({ reply: it.pergunta ?? "Faltam arquivos." });

  const job = jobs.novo();
  const { carteiras, transcricoes } = it;
  jobs.submeter(job, (p) => rodar({
    carteiras, transcricoes, assessor: it.assessor, dataR2: it.dataR2, outDir: job.dir, formatos: ["pptx", "pdf"],
  }, criarChatJson(uso), uso, p));

  const dataTxt = it.dataR2.toISOString().slice(0, 10).split("-").reverse().join("/");
  const notas = [
    `Carteira: ${carteiras.map((a) => a.nome).join(", ")}. Transcrição: ${transcricoes.map((a) => a.nome).join(", ")}.`,
    `Assessor: ${it.assessor}${it.assessorInformado ? "" : " (padrão, você não informou)"}. Data da R2: ${dataTxt}${it.dataInformada ? "" : " (hoje, você não informou)"}.`,
    it.ignorados.length ? `Não usei: ${it.ignorados.join("; ")}.` : "",
    it.contextos.length ? `Não usei como contexto (só a conversa do chat usa): ${it.contextos.map((a) => a.nome).join("; ")}.` : "",
    ...it.avisos.map((a) => `Atenção: ${a}`),
  ].filter(Boolean).join("\n");
  return Response.json({ reply: `Entendi. Vou montar o deck da R2.\n${notas}`, jobId: job.id });
}
