import { autorizado, negado } from "@/lib/auth";
import { criarChatJson, novoUso, type Uso } from "@/lib/bedrock";
import { CanceladoError, checarCancelado } from "@/lib/cancelamento";
import { aplicarAjustes, copiarCaso, restaurarCaso, eDerivada, hashTexto, obterCaso, publicoCaso, rebaixarCarteirasSubstituiveis, removerDerivada, temCarteiraReal, temExtrato, tocar, valoresParaCarteira, type Caso, type Fonte } from "@/lib/caso";
import { interpretarInstrucao, MAX_INSTRUCAO } from "@/lib/instrucao";
import { interpretar } from "@/lib/chat";
import { config } from "@/lib/config";
import { deckSaude } from "@/lib/deck";
import { MAX_ARQUIVOS, MAX_LOTE_MB } from "@/lib/formatos";
import { derivarCarteira, leitura } from "@/lib/pipeline";
import { resumoDoCaso } from "@/lib/resumo";
import { respostaSSE } from "@/lib/sse";
import { eSubstituivelPorExtrato as eSubstituivel } from "@/lib/triagem-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Enviar = (evento: string, dados: unknown) => void;

/** Monta a carteira com os valores que o lead citou na R1. Devolve a frase com o resultado. */
async function usarTranscricao(caso: Caso, uso: Uso, enviar: Enviar): Promise<string> {
  if (!caso.fontes.some((f) => f.papel === "transcricao")) return "Ainda não recebi a transcrição da R1. Anexe o arquivo ou cole o texto aqui.";
  if (temCarteiraReal(caso)) return "A carteira enviada já está em uso. Não preciso dos valores da transcrição.";
  const SEM_VALOR = "Não achei valores investidos na fala do lead. Preciso da carteira: anexe o extrato ou cole a posição aqui.";
  if (!valoresParaCarteira(caso).length && !caso.fontes.some(eDerivada)) return SEM_VALOR;
  enviar("atividade", { pct: 5, msg: "Lendo os valores citados na R1" });
  const ativos = await derivarCarteira(caso, criarChatJson(uso), (_etapa, pct, m) => enviar("atividade", { pct, msg: m }));
  if (!ativos.length) return SEM_VALOR;
  const lista = ativos.map((a) => `${a.nome}, ${a.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`).join("; ");
  return `Montei a carteira com o que o lead disse na R1: ${lista} (aproximado). Confirme o extrato antes da R2.`;
}

const erro = (reply: string, status: number) => Response.json({ erro: reply }, { status });

export async function POST(req: Request, ctx: RouteContext<"/api/conversas/[id]/mensagens">) {
  if (!autorizado(req)) return negado();
  const caso = obterCaso((await ctx.params).id);
  if (!caso) return erro("Conversa não encontrada ou expirada. Abra uma nova conversa.", 404);
  if (caso.ocupado) return erro("Ainda estou processando a mensagem anterior.", 409);

  let form: FormData;
  try { form = await req.formData(); } catch { return erro("Não consegui ler o envio. Tente anexar de novo.", 400); }
  const msg = String(form.get("message") ?? "");
  const arquivos = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (arquivos.length > MAX_ARQUIVOS) return erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.`, 400);
  for (const f of arquivos) if (f.size > config.maxUploadMb * 1024 * 1024) return erro(`"${f.name}" passa de ${config.maxUploadMb} MB.`, 413);
  if (arquivos.reduce((t, f) => t + f.size, 0) > MAX_LOTE_MB * 1024 * 1024) return erro(`O envio passa de ${MAX_LOTE_MB} MB no total.`, 413);

  // Antes de enviar qualquer texto ou arquivo à LLM, confirma que o serviço que monta o deck está no ar.
  const saude = await deckSaude();
  if (!saude.ok) return erro(`O serviço que monta o deck não está pronto (${saude.erro}). Não enviei nada para análise. Avise o time e tente de novo.`, 503);

  const declarados: Record<string, "carteira" | "transcricao"> = {};
  for (const [k, v] of form.entries())
    if (k.startsWith("papel:") && (v === "carteira" || v === "transcricao")) declarados[k.slice(6)] = v;

  const copia = copiarCaso(caso); // se o assessor cancelar, a mensagem some do caso como se não tivesse sido enviada
  caso.ocupado = true;
  const uso = novoUso();
  return respostaSSE(async (enviar, signal) => {
    try {
      // Mensagem curta sobre um caso aberto: o LLM diz se é um pedido ("usar a transcrição") ou um dado do lead.
      const curta = msg.trim().length > 0 && msg.trim().length <= MAX_INSTRUCAO;
      if (!arquivos.length && curta && caso.fontes.length) {
        const ins = await interpretarInstrucao(msg, caso, uso);
        if (ins && (ins.usarTranscricao || Object.keys(ins.ajustes).length)) {
          const partes: string[] = [];
          if (Object.keys(ins.ajustes).length) {
            if (!caso.lead) partes.push("Ainda não li a transcrição da R1, então não tenho onde anotar os dados do lead. Anexe a transcrição.");
            else {
              const antes = caso.lead;
              caso.ajustesLead = { ...caso.ajustesLead, ...ins.ajustes,
                objetivos: [...(caso.ajustesLead?.objetivos ?? []), ...(ins.ajustes.objetivos ?? [])] };
              caso.lead = aplicarAjustes(antes, ins.ajustes);
              for (const campo of ["primeiro_nome", "perfil", "objetivos"] as const)
                if (JSON.stringify(antes[campo]) !== JSON.stringify(caso.lead[campo]))
                  caso.edicoes.push({ quando: Date.now(), campo: `lead.${campo}`, antes: antes[campo], depois: caso.lead[campo], origem: "assessor" });
              caso.rascunho = undefined; // o rascunho depende do lead
              const dados = [ins.ajustes.primeiro_nome && `nome ${ins.ajustes.primeiro_nome}`, ins.ajustes.perfil && `perfil ${ins.ajustes.perfil}`,
                ins.ajustes.objetivos?.length && `objetivo${ins.ajustes.objetivos.length > 1 ? "s" : ""}: ${ins.ajustes.objetivos.join("; ")}`].filter(Boolean);
              partes.push(`Anotei no lead: ${dados.join(", ")}.`);
            }
          }
          if (ins.usarTranscricao) partes.push(await usarTranscricao(caso, uso, enviar));
          tocar(caso);
          enviar("texto", { texto: [...partes, resumoDoCaso(caso, [])].join("\n") });
          enviar("caso", publicoCaso(caso));
          enviar("fim", { tokens: uso });
          return;
        }
      }

      checarCancelado();
      const bufs = await Promise.all(arquivos.map(async (f) => ({ nome: f.name, buf: Buffer.from(await f.arrayBuffer()) })));
      let it;
      try { it = await interpretar(msg, bufs, uso, declarados); }
      catch (e) { enviar("erro", { mensagem: e instanceof Error ? e.message : "Erro ao ler os anexos." }); return; }

      if (it.assessorInformado) caso.assessor = it.assessor;
      if (it.dataInformada) {
        const nova = it.dataR2.toISOString().slice(0, 10);
        if (nova !== caso.dataR2) caso.rascunho = undefined; // a data entra no texto do rascunho
        caso.dataR2 = nova;
      }

      const novos: Fonte[] = [];
      const ignorados = [...it.ignorados];
      const avisosTriagem = it.avisos.map((a) => a.charAt(0).toUpperCase() + a.slice(1));
      const origem = (a: { nome: string }) => (declarados[a.nome] ? "usuario" : "automatico");
      for (const [papel, anexos] of [["carteira", it.carteiras], ["transcricao", it.transcricoes], ["contexto", it.contextos]] as const)
        for (const a of anexos) {
          const hash = hashTexto(a.texto ?? "");
          if (caso.fontes.some((f) => f.hash === hash)) { ignorados.push(`${a.nome} (já enviado nesta conversa)`); continue; }
          novos.push({ nome: a.nome, papel, origemPapel: origem(a), texto: a.texto ?? "", hash, tipo: it.detalhes[a.nome]?.tipo });
        }
      // Deck anterior ou anotações com posição só valem como carteira enquanto não há extrato, nem no caso nem neste envio.
      const chegouExtrato = novos.some((f) => f.papel === "carteira" && !eSubstituivel(f.tipo));
      for (const f of novos)
        if (f.papel === "carteira" && eSubstituivel(f.tipo) && (chegouExtrato || temExtrato(caso))) f.papel = "contexto";
      // nomes repetidos entre mensagens ficam distinguíveis
      for (const f of novos) if (caso.fontes.some((x) => x.nome === f.nome)) f.nome = `${f.nome} (${caso.fontes.length + 1})`;
      // A carteira real substitui a derivada. Transcrição nova deixa a derivada velha: sai também.
      const trocou = novos.length > 0 && removerDerivada(caso);
      caso.fontes.push(...novos);
      const rebaixadas = chegouExtrato ? rebaixarCarteirasSubstituiveis(caso) : [];
      const notaContexto = rebaixadas.length ? `\nChegou o extrato, então ${rebaixadas.map((n) => `"${n}"`).join(", ")} deixou de ser carteira e ficou só como contexto do lead.` : "";
      const nota0 = !trocou ? "" : "\n" + (novos.some((f) => f.papel === "carteira") ? "Troquei os valores citados na R1 pela carteira enviada."
        : "A transcrição mudou, então os valores citados na R1 saíram da carteira. Peça de novo para usar a transcrição.");
      const nota = nota0 + notaContexto;
      tocar(caso);

      if (!novos.length) {
        const base = it.pergunta && !caso.fontes.length ? it.pergunta : resumoDoCaso(caso, [], avisosTriagem);
        enviar("texto", { texto: base + (ignorados.length ? `\nNão usei: ${ignorados.join("; ")}.` : "") });
        enviar("caso", publicoCaso(caso));
        enviar("fim", {});
        return;
      }

      enviar("atividade", { pct: 5, msg: "Lendo os arquivos" });
      await leitura(caso, criarChatJson(uso), (_etapa, pct, m) => enviar("atividade", { pct, msg: m }));
      tocar(caso);
      const resumo = resumoDoCaso(caso, novos.map((f) => f.nome), avisosTriagem);
      enviar("texto", { texto: resumo + nota + (ignorados.length ? `\nNão usei: ${ignorados.join("; ")}.` : "") });
      enviar("caso", publicoCaso(caso));
      checarCancelado();
      enviar("fim", { tokens: uso });
    } catch (e) {
      if (e instanceof CanceladoError || signal.aborted) restaurarCaso(caso, copia);
      throw e;
    } finally { caso.ocupado = false; }
  }, req.signal);
}
