/** `GET /eventos` (SSE do DO) e `POST /cancelar`. */
import { conversaRpc } from "./conversaRpc";
import { apagarMensagem } from "../db/mensagens";
import type { PayloadTurno } from "../db/tipos";
import { autenticarConversa, ehResposta, protegida } from "./comum";

/** Repassa o SSE do DO como está. `Last-Event-ID` inválido é ignorado (o DO manda o estado e o que há da tarefa ativa). */
export function getEventos(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("eventos.GET", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const bruto = req.headers.get("last-event-id");
    const ultimo = bruto !== null && /^\d{1,15}$/.test(bruto.trim()) ? bruto.trim() : null;
    return conversaRpc(a.conversa.id, a.env).sse(ultimo);
  });
}

/**
 * Cancela a tarefa ativa (idempotente). Tarefa de turno ainda na fila: o DO a encerra na hora e restaura o caso, e o consumidor
 * nunca a executa, então esta rota apaga a mensagem do assessor (`payload.mensagemId`). Tarefa já rodando: o consumidor vê a marca
 * e apaga a mensagem ao encerrar com `cancelada`.
 */
export function postCancelar(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("cancelar.POST", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const r = await conversaRpc(a.conversa.id, a.env).cancelar();
    if (r.cancelada && r.tarefa?.tipo === "turno") {
      const mensagemId = (r.payload as Partial<PayloadTurno> | null | undefined)?.mensagemId;
      if (typeof mensagemId === "string") await apagarMensagem(a.env, a.conversa.id, mensagemId);
    }
    return Response.json({ ok: true }, { status: 202 });
  });
}
