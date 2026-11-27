/**
 * Conversas em D1 (migrations/0001_chat.sql). Consultas sempre parametrizadas.
 * Toda leitura de uma rota filtra `usuario_id` (vindo de `usuarioAtual`) e `apagada IS NULL`: o id da conversa sozinho não dá acesso.
 * As funções sem `usuarioId` (`atualizarConversa`, `apagarLinhas`) são internas do consumidor e da purga, que já têm o dono conferido.
 */
import { env } from "../cf";
import type { ConversaResumo } from "./tipos";

export const POR_PAGINA = 30;
export const TITULO_PADRAO = "Nova conversa";
export const ID_CONVERSA = /^[0-9a-f]{32}$/;

interface Linha extends Record<string, unknown> {
  id: string;
  titulo: string;
  criada: number;
  atualizada: number;
  ctx_tokens: number;
  ctx_limite: number;
}

const COLUNAS = "id, titulo, criada, atualizada, ctx_tokens, ctx_limite";

const resumo = (l: Linha): ConversaResumo => ({
  id: l.id,
  titulo: l.titulo,
  criada: l.criada,
  atualizada: l.atualizada,
  ctxTokens: l.ctx_tokens,
  ctxLimite: l.ctx_limite,
});

/** 128 bits em 32 hex, o mesmo formato de `casoAvulso`. */
export function novoIdConversa(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function criarConversa(
  e: CloudflareEnv,
  c: { usuarioId: string; titulo?: string; ctxLimite: number },
): Promise<ConversaResumo> {
  const id = novoIdConversa();
  const agora = Date.now();
  const titulo = c.titulo?.trim() || TITULO_PADRAO;
  await env(e)
    .DB.prepare("INSERT INTO conversas (id, usuario_id, titulo, criada, atualizada, ctx_tokens, ctx_limite) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .bind(id, c.usuarioId, titulo, agora, agora, c.ctxLimite)
    .run();
  return { id, titulo, criada: agora, atualizada: agora, ctxTokens: 0, ctxLimite: c.ctxLimite };
}

/** A conversa do usuário, ou null se não existir, for de outro usuário ou estiver apagada (a rota responde 404 nos três casos). */
export async function obterConversa(e: CloudflareEnv, usuarioId: string, id: string): Promise<ConversaResumo | null> {
  if (!ID_CONVERSA.test(id)) return null;
  const l = await env(e)
    .DB.prepare(`SELECT ${COLUNAS} FROM conversas WHERE id = ? AND usuario_id = ? AND apagada IS NULL`)
    .bind(id, usuarioId)
    .first<Linha>();
  return l ? resumo(l) : null;
}

const CURSOR = /^(\d{1,16})_([0-9a-f]{32})$/;

/** Cursor opaco para o cliente: a última linha da página, `(atualizada, id)`. */
export const codificarCursor = (c: Pick<ConversaResumo, "atualizada" | "id">) => `${c.atualizada}_${c.id}`;

/** Cursor inválido vira null (a rota responde 400). */
export function decodificarCursor(cursor: string): { atualizada: number; id: string } | null {
  const m = CURSOR.exec(cursor);
  return m ? { atualizada: Number(m[1]), id: m[2] } : null;
}

/**
 * Página de conversas do usuário, da mais recente para a mais antiga. O cursor é a chave estável `(atualizada, id)`: o desempate
 * por id evita repetir ou pular conversas com o mesmo `atualizada`. Usa o índice `conversas_usuario`.
 */
export async function listarConversas(
  e: CloudflareEnv,
  usuarioId: string,
  opcoes: { cursor?: { atualizada: number; id: string } | null; limite?: number } = {},
): Promise<{ itens: ConversaResumo[]; cursor: string | null }> {
  const limite = Math.min(Math.max(1, Math.floor(opcoes.limite ?? POR_PAGINA)), 100);
  const c = opcoes.cursor;
  const db = env(e).DB;
  const stmt = c
    ? db
        .prepare(
          `SELECT ${COLUNAS} FROM conversas WHERE usuario_id = ? AND apagada IS NULL AND (atualizada < ? OR (atualizada = ? AND id < ?))
           ORDER BY atualizada DESC, id DESC LIMIT ?`,
        )
        .bind(usuarioId, c.atualizada, c.atualizada, c.id, limite + 1)
    : db
        .prepare(`SELECT ${COLUNAS} FROM conversas WHERE usuario_id = ? AND apagada IS NULL ORDER BY atualizada DESC, id DESC LIMIT ?`)
        .bind(usuarioId, limite + 1);
  const { results } = await stmt.all<Linha>();
  const mais = results.length > limite;
  const itens = results.slice(0, limite).map(resumo);
  return { itens, cursor: mais ? codificarCursor(itens[itens.length - 1]) : null };
}

/**
 * Atualiza título e/ou medidor e sempre toca `atualizada`. Interna: o chamador (consumidor, ou rota depois de `obterConversa`)
 * já conferiu o dono. Não faz nada numa conversa apagada, para um consumidor atrasado não a "ressuscitar" na ordenação.
 */
export async function atualizarConversa(
  e: CloudflareEnv,
  conversaId: string,
  campos: { titulo?: string; ctxTokens?: number; ctxLimite?: number },
): Promise<void> {
  const sets = ["atualizada = ?"];
  const valores: unknown[] = [Date.now()];
  if (campos.titulo !== undefined) { sets.push("titulo = ?"); valores.push(campos.titulo); }
  if (campos.ctxTokens !== undefined) { sets.push("ctx_tokens = ?"); valores.push(Math.max(0, Math.floor(campos.ctxTokens))); }
  if (campos.ctxLimite !== undefined) { sets.push("ctx_limite = ?"); valores.push(Math.max(1, Math.floor(campos.ctxLimite))); }
  await env(e)
    .DB.prepare(`UPDATE conversas SET ${sets.join(", ")} WHERE id = ? AND apagada IS NULL`)
    .bind(...valores, conversaId)
    .run();
}

/** Renomeia a conversa do usuário sem mudar `atualizada` (renomear não deve reordenar a lista). Devolve false se não for dele. */
export async function renomearConversa(e: CloudflareEnv, usuarioId: string, id: string, titulo: string): Promise<boolean> {
  const r = await env(e)
    .DB.prepare("UPDATE conversas SET titulo = ? WHERE id = ? AND usuario_id = ? AND apagada IS NULL")
    .bind(titulo, id, usuarioId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/**
 * Marca a conversa do usuário como apagada: some da lista na hora, e a purga (R2, DO, D1) roda pela fila. Devolve false se não era
 * dele ou já estava apagada. Não toca `atualizada`: a ordem da purga pendente não depende dela.
 */
export async function marcarApagada(e: CloudflareEnv, usuarioId: string, id: string): Promise<boolean> {
  const r = await env(e)
    .DB.prepare("UPDATE conversas SET apagada = ? WHERE id = ? AND usuario_id = ? AND apagada IS NULL")
    .bind(Date.now(), id, usuarioId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export interface ConversaDeUsuario {
  id: string;
  usuarioId: string;
}

/**
 * Purgas pendentes: conversas marcadas como apagadas cujas linhas ainda existem. Mais antigas primeiro (usa `conversas_purga`).
 * `apagadaAntesDe` ignora as marcadas há pouco, que ainda devem estar na fila.
 */
export async function listarPendentesPurga(e: CloudflareEnv, limite = 100, apagadaAntesDe = Number.MAX_SAFE_INTEGER): Promise<ConversaDeUsuario[]> {
  const { results } = await env(e)
    .DB.prepare("SELECT id, usuario_id FROM conversas WHERE apagada IS NOT NULL AND apagada < ? ORDER BY apagada, id LIMIT ?")
    .bind(apagadaAntesDe, limite)
    .all<{ id: string; usuario_id: string }>();
  return results.map((r) => ({ id: r.id, usuarioId: r.usuario_id }));
}

/** Conversas ativas sem uso desde `antesDe` (ms). Mais antigas primeiro (usa `conversas_purga`). */
export async function listarInativas(e: CloudflareEnv, antesDe: number, limite = 100): Promise<ConversaDeUsuario[]> {
  const { results } = await env(e)
    .DB.prepare("SELECT id, usuario_id FROM conversas WHERE apagada IS NULL AND atualizada < ? ORDER BY atualizada, id LIMIT ?")
    .bind(antesDe, limite)
    .all<{ id: string; usuario_id: string }>();
  return results.map((r) => ({ id: r.id, usuarioId: r.usuario_id }));
}

/**
 * Marca como apagada uma conversa inativa. Reconfere `atualizada < antesDe`: se o assessor voltou a usá-la entre a listagem e agora,
 * a conversa fica. Devolve false nesse caso.
 */
export async function marcarApagadaSeInativa(e: CloudflareEnv, id: string, antesDe: number): Promise<boolean> {
  const r = await env(e)
    .DB.prepare("UPDATE conversas SET apagada = ? WHERE id = ? AND apagada IS NULL AND atualizada < ?")
    .bind(Date.now(), id, antesDe)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** Último passo da purga: apaga as mensagens e a conversa. Idempotente. Só apaga conversa já marcada como `apagada`. */
export async function apagarLinhas(e: CloudflareEnv, conversaId: string): Promise<void> {
  const db = env(e).DB;
  await db.batch([
    db.prepare("DELETE FROM mensagens WHERE conversa_id = ? AND conversa_id IN (SELECT id FROM conversas WHERE id = ? AND apagada IS NOT NULL)").bind(conversaId, conversaId),
    db.prepare("DELETE FROM conversas WHERE id = ? AND apagada IS NOT NULL").bind(conversaId),
  ]);
}

/** O dono e a marca de exclusão de uma conversa, sem filtro de usuário (uso exclusivo da purga). Null se a linha não existe mais. */
export async function linhaParaPurga(e: CloudflareEnv, id: string): Promise<{ usuarioId: string; apagada: number | null } | null> {
  const l = await env(e)
    .DB.prepare("SELECT usuario_id, apagada FROM conversas WHERE id = ?")
    .bind(id)
    .first<{ usuario_id: string; apagada: number | null }>();
  return l ? { usuarioId: l.usuario_id, apagada: l.apagada } : null;
}
