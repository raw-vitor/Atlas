/** Mensagens em D1 (migrations/0001_chat.sql). Só mensagens finais: o progresso fica no Durable Object. */
import { env } from "../cf";
import type { MensagemSalva } from "./tipos";

export const POR_PAGINA_MENSAGENS = 50;

interface Linha extends Record<string, unknown> {
  id: string;
  seq: number;
  id_cliente: string | null;
  tipo: MensagemSalva["tipo"];
  texto: string | null;
  meta: string | null;
  criada: number;
}

const COLUNAS = "id, seq, id_cliente, tipo, texto, meta, criada";

function mensagem(l: Linha): MensagemSalva {
  const m: MensagemSalva = { id: l.id, seq: l.seq, criada: l.criada, tipo: l.tipo };
  if (l.id_cliente !== null) m.idCliente = l.id_cliente;
  if (l.texto !== null) m.texto = l.texto;
  if (l.meta !== null) {
    try { m.meta = JSON.parse(l.meta) as MensagemSalva["meta"]; } catch { /* meta corrompida: entrega a mensagem sem ela */ }
  }
  return m;
}

const ehIdClienteRepetido = (e: unknown) => e instanceof Error && /UNIQUE constraint failed.*id_cliente|mensagens_id_cliente/i.test(e.message);

/**
 * Grava uma mensagem e toca `conversas.atualizada`, na mesma transação do D1 (`batch`). O `seq` é `MAX(seq) + 1` calculado dentro
 * do próprio INSERT: o D1 executa uma instrução por vez por banco, então duas gravações simultâneas não repetem o número.
 *
 * - `idCliente` repetido na mesma conversa (reenvio do mesmo POST): a restrição única recusa a segunda inserção e a função devolve
 *   a mensagem já gravada, sem gravar de novo.
 * - `id` opcional: a rota o gera antes de pegar a trava da conversa, para guardá-lo no payload da tarefa.
 * - Conversa que não existe mais (purgada): a chave estrangeira recusa e a função lança.
 * - `titulo`: só aplicado se a conversa ainda se chama "Nova conversa" (a primeira mensagem do assessor define o título).
 */
export async function gravarMensagem(
  e: CloudflareEnv,
  m: {
    conversaId: string;
    tipo: MensagemSalva["tipo"];
    texto?: string;
    meta?: MensagemSalva["meta"];
    idCliente?: string;
    id?: string;
    titulo?: string;
  },
): Promise<MensagemSalva> {
  const db = env(e).DB;
  const id = m.id ?? crypto.randomUUID().replaceAll("-", "");
  const agora = Date.now();
  const meta = m.meta === undefined ? null : JSON.stringify(m.meta);
  const insere = db
    .prepare(
      `INSERT INTO mensagens (conversa_id, seq, id, id_cliente, tipo, texto, meta, criada)
       SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ? FROM mensagens WHERE conversa_id = ?
       RETURNING ${COLUNAS}`,
    )
    .bind(m.conversaId, id, m.idCliente ?? null, m.tipo, m.texto ?? null, meta, agora, m.conversaId);
  const toca = m.titulo
    ? db
        .prepare("UPDATE conversas SET atualizada = ?, titulo = CASE WHEN titulo = 'Nova conversa' THEN ? ELSE titulo END WHERE id = ?")
        .bind(agora, m.titulo, m.conversaId)
    : db.prepare("UPDATE conversas SET atualizada = ? WHERE id = ?").bind(agora, m.conversaId);
  try {
    const [r] = await db.batch<Linha>([insere, toca]);
    return mensagem(r.results[0]);
  } catch (erro) {
    if (m.idCliente !== undefined && ehIdClienteRepetido(erro)) {
      const existente = await db
        .prepare(`SELECT ${COLUNAS} FROM mensagens WHERE conversa_id = ? AND id_cliente = ?`)
        .bind(m.conversaId, m.idCliente)
        .first<Linha>();
      if (existente) return mensagem(existente);
    }
    throw erro;
  }
}

/** A mensagem do assessor com este `idCliente` nesta conversa (para responder a um reenvio sem pegar a trava). */
export async function obterMensagemPorIdCliente(
  e: CloudflareEnv,
  usuarioId: string,
  conversaId: string,
  idCliente: string,
): Promise<MensagemSalva | null> {
  const l = await env(e)
    .DB.prepare(
      `SELECT ${COLUNAS.split(", ").map((c) => `m.${c}`).join(", ")} FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
       WHERE m.conversa_id = ? AND m.id_cliente = ? AND c.usuario_id = ? AND c.apagada IS NULL`,
    )
    .bind(conversaId, idCliente, usuarioId)
    .first<Linha>();
  return l ? mensagem(l) : null;
}

/** Remove uma mensagem (cancelamento: a mensagem do assessor some como se não tivesse sido enviada). Idempotente. */
export async function apagarMensagem(e: CloudflareEnv, conversaId: string, id: string): Promise<void> {
  await env(e).DB.prepare("DELETE FROM mensagens WHERE conversa_id = ? AND id = ?").bind(conversaId, id).run();
}

/**
 * Até `limite` mensagens com `seq` menor que `antes` (ou as últimas, sem `antes`), em ordem crescente de `seq`. `maisAntigas` diz se há
 * mais para rolar. Filtra o dono pela própria consulta, além de a rota já ter conferido a conversa.
 */
export async function listarMensagens(
  e: CloudflareEnv,
  usuarioId: string,
  conversaId: string,
  opcoes: { antes?: number; limite?: number } = {},
): Promise<{ itens: MensagemSalva[]; maisAntigas: boolean }> {
  const limite = Math.min(Math.max(1, Math.floor(opcoes.limite ?? POR_PAGINA_MENSAGENS)), 200);
  const antes = opcoes.antes ?? Number.MAX_SAFE_INTEGER;
  const { results } = await env(e)
    .DB.prepare(
      `SELECT ${COLUNAS} FROM mensagens
       WHERE conversa_id = ? AND seq < ? AND EXISTS (SELECT 1 FROM conversas c WHERE c.id = ? AND c.usuario_id = ? AND c.apagada IS NULL)
       ORDER BY seq DESC LIMIT ?`,
    )
    .bind(conversaId, antes, conversaId, usuarioId, limite + 1)
    .all<Linha>();
  return { maisAntigas: results.length > limite, itens: results.slice(0, limite).reverse().map(mensagem) };
}
