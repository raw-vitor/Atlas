/** `GET/POST /api/conversas`, `GET/PATCH/DELETE /api/conversas/{id}`. */
import { negado, usuarioAtual } from "../auth";
import { env } from "../cf";
import { conversaRpc } from "./conversaRpc";
import { config } from "../config";
import { criarConversa, decodificarCursor, listarConversas, marcarApagada, renomearConversa, obterConversa } from "../db/conversas";
import { janelaContexto } from "../modelos";
import { FAIXAS } from "../tarefas/tipos";
import { casoAvulso, publicoCaso } from "../caso";
import { casoPublicoDe } from "./caso";
import { autenticarConversa, ehResposta, erro, lerJson, naoEncontrada, protegida } from "./comum";

export const MAX_TITULO = 80;

/** Limite do medidor para conversas novas: `ATLAS_CONTEXTO_TOKENS` se > 0, senão a janela do modelo em uso (decisão D4). */
export function limiteDoAmbiente(e: CloudflareEnv): number {
  const sobreposto = Math.max(0, Math.floor(Number((e.ATLAS_CONTEXTO_TOKENS ?? "").trim())) || 0) || config.contextoTokens;
  return sobreposto > 0 ? sobreposto : janelaContexto((e.BEDROCK_MODEL_ID ?? "").trim() || config.modelId);
}

/** Título em uma linha, sem espaços repetidos, com no máximo `max` caracteres (sem partir um par substituto). */
export function tituloDe(texto: string, max = MAX_TITULO): string {
  return Array.from(texto.replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

export function getConversas(req: Request, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("conversas.GET", async () => {
    const e = env(injetado);
    const usuario = await usuarioAtual(req, e);
    if (!usuario) return negado();
    const bruto = new URL(req.url).searchParams.get("cursor");
    const cursor = bruto ? decodificarCursor(bruto) : null;
    if (bruto && !cursor) return erro("Cursor inválido.", 400);
    return Response.json(await listarConversas(e, usuario.id, { cursor }));
  });
}

export function postConversas(req: Request, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("conversas.POST", async () => {
    const e = env(injetado);
    const usuario = await usuarioAtual(req, e);
    if (!usuario) return negado();
    const corpo = req.headers.get("content-length") === "0" ? {} : await lerJson(req);
    if (!corpo) return erro("Corpo inválido.", 400);
    if (corpo.titulo !== undefined && typeof corpo.titulo !== "string") return erro("Título inválido.", 400);
    const conversa = await criarConversa(e, {
      usuarioId: usuario.id,
      titulo: corpo.titulo ? tituloDe(corpo.titulo) : undefined,
      ctxLimite: limiteDoAmbiente(e),
    });
    return Response.json({ conversa, caso: publicoCaso({ ...casoAvulso(), id: conversa.id }) }, { status: 201 });
  });
}

export function getConversa(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("conversa.GET", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const stub = conversaRpc(a.conversa.id, a.env);
    const [estado, salvo] = await Promise.all([stub.estado(), stub.obterCaso()]);
    if (estado.purgada) return naoEncontrada();
    const tarefa = estado.tarefa;
    const caso = await casoPublicoDe(a.env, a.usuario.id, a.conversa.id, tarefa, salvo.caso);
    return Response.json({ conversa: a.conversa, caso, tarefa, contexto: estado.contexto, alertasVistos: estado.alertasVistos });
  });
}

export function patchConversa(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("conversa.PATCH", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    const corpo = await lerJson(req);
    if (!corpo) return erro("Corpo inválido.", 400);
    const { titulo, alertaVisto } = corpo;
    if (titulo === undefined && alertaVisto === undefined) return erro("Nada para atualizar.", 400);
    if (titulo !== undefined && (typeof titulo !== "string" || !tituloDe(titulo))) return erro("Título inválido.", 400);
    if (alertaVisto !== undefined && !FAIXAS.includes(alertaVisto as (typeof FAIXAS)[number])) return erro("Faixa de alerta inválida.", 400);
    if (alertaVisto !== undefined) await conversaRpc(a.conversa.id, a.env).alertaVisto(alertaVisto as number);
    if (typeof titulo === "string") await renomearConversa(a.env, a.usuario.id, a.conversa.id, tituloDe(titulo));
    const conversa = await obterConversa(a.env, a.usuario.id, a.conversa.id);
    return conversa ? Response.json({ conversa }) : naoEncontrada();
  });
}

/**
 * Exclusão: marca `apagada` em D1 (a conversa some da lista e as rotas passam a responder 404), cancela a tarefa em andamento e enfileira
 * `{tipo: "purga"}`. A marca vem primeiro: nenhuma mensagem nova entra enquanto a purga não termina. Se o envio à fila falhar, a marca em
 * D1 mantém a purga pendente e o cron diário a refaz; o assessor já não vê a conversa, então a resposta continua 204.
 */
export function deleteConversa(req: Request, id: string, injetado?: CloudflareEnv): Promise<Response> {
  return protegida("conversa.DELETE", async () => {
    const a = await autenticarConversa(req, id, injetado);
    if (ehResposta(a)) return a;
    if (!(await marcarApagada(a.env, a.usuario.id, a.conversa.id))) return naoEncontrada();
    const falha = (passo: string) => (e: unknown) =>
      console.error(`[api] exclusão: ${passo} falhou (a purga fica para o cron)`, { conversaId: a.conversa.id, erro: e instanceof Error ? e.name : "desconhecido" });
    await conversaRpc(a.conversa.id, a.env).cancelar().catch(falha("cancelar"));
    await a.env.TAREFAS.send({ tipo: "purga", conversaId: a.conversa.id, usuarioId: a.usuario.id }).catch(falha("fila"));
    return new Response(null, { status: 204 });
  });
}
