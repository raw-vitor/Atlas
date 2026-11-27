/** `POST /api/conversas/{id}/acoes` `{acao: "gerar"}`. A execução (rascunho + deck) é do consumidor da fila. */
import schema from "../schemas/constantes.json";
import { conversaRpc } from "./conversaRpc";
import type { PayloadDeck } from "../db/tipos";
import { prontidao, type Caso } from "../caso";
import { tarefaAtiva } from "./caso";
import { autenticarConversa, ehResposta, erro, lerJson, protegida } from "./comum";

const ESPERA_SAUDE_MS = 30_000;

/**
 * Confere que o deck-service responde e usa o mesmo schema do Atlas, antes de gastar chamadas ao LLM. O Container sobe sob demanda:
 * a primeira checagem do dia pode levar alguns segundos. Qualquer falha é "indisponível" (503), nunca exceção.
 */
export async function saudeDeck(e: CloudflareEnv): Promise<{ ok: boolean; erro?: string }> {
  if (!e.DECK) return { ok: false, erro: "o serviço do deck não está configurado" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stub = e.DECK.get(e.DECK.idFromName("pool-0"));
    const espera = new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error("sem resposta no prazo")), ESPERA_SAUDE_MS); });
    const r = await Promise.race([stub.fetch(new Request("http://deck/health")), espera]);
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { schema_hash?: string };
    if (j.schema_hash !== schema.SCHEMA_HASH) return { ok: false, erro: "o serviço do deck está com o schema desatualizado" };
    return { ok: true };
  } catch (falha) {
    return { ok: false, erro: falha instanceof Error ? falha.message.slice(0, 120) : "falha desconhecida" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function postAcoes(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("acoes.POST", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const { env: e, usuario, conversa } = a;
    const corpo = await lerJson(req);
    if (!corpo) return erro("Corpo inválido.", 400);
    if (corpo.acao !== "gerar") return erro("Ação desconhecida.", 400);

    const stub = conversaRpc(conversa.id, e);
    const [estado, salvo] = await Promise.all([stub.estado(), stub.obterCaso()]);
    if (estado.purgada) return erro("Conversa não encontrada.", 404);
    if (tarefaAtiva(estado.tarefa)) return erro("Ainda estou processando outra tarefa neste caso.", 409, { tarefa: estado.tarefa });

    // Sem caso salvo (conversa sem nada enviado), a prontidão calcula tudo como faltando.
    const pr = prontidao((salvo.caso ?? { fontes: [], ativos: [], decks: [], historico: [], edicoes: [] }) as Caso);
    if (!pr.pronto) return erro(`Ainda falta: ${pr.faltas.join("; ")}.`, 422, { faltas: pr.faltas });

    const saude = await saudeDeck(e);
    if (!saude.ok) return erro(`O serviço que monta o deck não está pronto (${saude.erro}). Avise o time e tente de novo.`, 503);

    const payload: PayloadDeck = { acao: "gerar" };
    const r = await stub.iniciarTarefa("deck", payload);
    if (!r.ok) return r.ocupado ? erro("Ainda estou processando outra tarefa neste caso.", 409, { tarefa: r.tarefa }) : erro("Conversa não encontrada.", 404);
    try {
      await e.TAREFAS.send({ tipo: "deck", conversaId: conversa.id, usuarioId: usuario.id, tarefaId: r.tarefa.id });
    } catch (falha) {
      await stub.terminarTarefa("erro", { tarefaId: r.tarefa.id, restaurar: false }).catch(() => undefined);
      console.error("[api] não enfileirou o deck", { conversaId: conversa.id, erro: falha instanceof Error ? falha.name : "desconhecido" });
      return erro("Não consegui colocar a geração na fila. Tente de novo.", 503);
    }
    return Response.json({ tarefa: r.tarefa }, { status: 202 });
  });
}
