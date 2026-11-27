/**
 * Consumidor do deck (`{tipo: "deck"}` em atlas-tarefas): a lógica do antigo `POST /api/conversas/{id}/acoes` + `lib/jobs.ts`.
 *   caso do DO + transcrição do R2 -> rascunho (só se não existir; é o único passo com LLM) -> deck-service (Container `DECK`)
 *   -> `v{n}.pptx` e `v{n}.pdf` no R2 -> mensagem `resultado` em D1 + `mensagem` no SSE -> `salvarCaso` com o deck na lista.
 * O progresso vai como evento `progresso` (`{etapa, pct, msg}`), o mesmo que `Evento` tinha. Os arquivos são servidos por
 * `GET /api/conversas/{id}/decks/{n}?fmt=`.
 */
import { novoUso, criarChatJson } from "../bedrock";
import { checarCancelado } from "../cancelamento";
import { hidratarFontes, obterCaso, prontidao, publicoCaso, salvarCaso, tocar } from "../caso";
import { deckSaude } from "../deck";
import { atualizarConversa } from "../db/conversas";
import { gravarMensagem } from "../db/mensagens";
import type { PayloadDeck } from "../db/tipos";
import { limiteContexto } from "../modelos";
import { deck, rascunho, type Progress, type Resultado } from "../pipeline";
import { chaveDeck } from "../r2";
import type { ContextoTarefa } from "./contexto";
import { executarTarefa, type Tarefa } from "./execucao/ciclo";
import { configDaTarefa } from "./execucao/config";
import { ErroDeTarefa } from "./execucao/erros";
import { medirContexto } from "./execucao/medidor";
import type { MensagemTarefa } from "./tipos";

/** A rota de ações confere o serviço antes de aceitar o pedido (503 se estiver fora, antes de gastar chamadas ao modelo). */
export { deckSaude };

const FORMATOS = ["pptx", "pdf"] as const;
const MIME: Record<(typeof FORMATOS)[number], string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
};

export function validarPayloadDeck(p: unknown): PayloadDeck | null {
  return p && typeof p === "object" && (p as Record<string, unknown>).acao === "gerar" ? { acao: "gerar" } : null;
}

/** Link de download que o card do deck usa (a rota confere o dono antes de ler o R2). */
export const urlDeck = (conversaId: string, versao: number, fmt: (typeof FORMATOS)[number]) =>
  `/api/conversas/${conversaId}/decks/${versao}?fmt=${fmt}`;

async function corpoDeck(t: Tarefa<PayloadDeck>): Promise<void> {
  const { env: e, conversaId, usuarioId, tarefaId } = t;
  const { caso, versao } = await obterCaso(e, conversaId);
  await hidratarFontes(e, usuarioId, conversaId, caso, ["transcricao"]); // o rascunho confere as citações com a transcrição
  const pr = prontidao(caso);
  if (!pr.pronto) throw new ErroDeTarefa(`Ainda falta: ${pr.faltas.join("; ")}.`);

  const uso = novoUso();
  const p: Progress = (etapa, pct, msg) => t.emitir("progresso", { etapa, pct, msg });
  const refazRascunho = !caso.rascunho;
  if (refazRascunho) {
    // O deck-service é conferido antes de gastar chamadas ao LLM.
    const saude = await deckSaude(e);
    if (!saude.ok) throw new ErroDeTarefa(`O serviço que monta o deck não está pronto (${saude.erro}). Avise o time e tente de novo.`);
    // Só quem vai chamar o LLM lê a config (uma consulta por chave primária). Snapshot: vale até o fim da tarefa.
    const config = await configDaTarefa(e, usuarioId, "deck");
    await rascunho(caso, criarChatJson(uso), p, 5, 85, config);
  }
  const gerado = await deck(caso, [...FORMATOS], uso, p, 88, e);
  await t.drenar();
  checarCancelado();

  const n = caso.decks.length + 1;
  await Promise.all(FORMATOS.map((fmt) =>
    e.ARQUIVOS.put(chaveDeck(usuarioId, conversaId, n, fmt), gerado.binarios[fmt]!, { httpMetadata: { contentType: MIME[fmt] } })));
  caso.decks.push({ jobId: tarefaId, versao: n, criadoEm: Date.now() });
  tocar(caso);
  const resultado: Resultado = { ...gerado.resultado, arquivos: { pptx: urlDeck(conversaId, n, "pptx"), pdf: urlDeck(conversaId, n, "pdf") } };

  await t.publicar("caso", publicoCaso(caso));
  let ctxTokens: number | undefined;
  if (refazRascunho) {
    const contexto = medirContexto(caso, uso.maiorEntrada, limiteContexto());
    ctxTokens = contexto.tokens;
    await t.publicar("contexto", contexto);
  }
  checarCancelado();
  const salva = await gravarMensagem(e, { conversaId, tipo: "resultado", meta: { versao: n, resultado }, idCliente: `atlas:${tarefaId}` });
  if (ctxTokens !== undefined)
    await atualizarConversa(e, conversaId, { ctxTokens, ctxLimite: limiteContexto() })
      .catch((x: unknown) => console.error("[deck] não atualizei o medidor em D1", { conversaId, erro: x instanceof Error ? x.name : "desconhecido" }));
  await t.publicar("mensagem", salva);
  const r = await salvarCaso(e, usuarioId, conversaId, caso, { versao, tarefaId });
  if (r.ok) return;
  if (r.motivo === "versao") throw new ErroDeTarefa("A conversa mudou enquanto eu montava os slides. Peça de novo.");
  t.abandonar();
}

export async function executarDeck(msg: Extract<MensagemTarefa, { tipo: "deck" }>, c: ContextoTarefa): Promise<void> {
  await executarTarefa<PayloadDeck>(msg, c, { validar: validarPayloadDeck, corpo: corpoDeck });
}
