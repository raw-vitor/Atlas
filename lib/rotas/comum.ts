/**
 * Base das rotas de conversa. Cada rota é uma função `(req, ..., env)` em `lib/rotas/*.ts`; os arquivos de `app/api/**` só
 * repassam `req`, os parâmetros e `env()`. Assim os testes (tests/workers) exercitam o mesmo código dentro do workerd, com o
 * `env` injetado.
 */
import { negado, usuarioAtual, type Usuario } from "../auth";
import { env } from "../cf";
import { obterConversa } from "../db/conversas";
import type { ConversaResumo } from "../db/tipos";

export const erro = (mensagem: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ erro: mensagem, ...extra }, { status });

export const naoEncontrada = () => erro("Conversa não encontrada.", 404);

export const ERRO_INTERNO = "Algo deu errado do nosso lado. Tente de novo em instantes.";

/** Corpo JSON como objeto, ou null se estiver ausente, malformado ou não for um objeto. */
export async function lerJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const c = (await req.json()) as unknown;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type RotaAutenticada = { usuario: Usuario; conversa: ConversaResumo; env: CloudflareEnv };

/**
 * Autentica e confere o dono da conversa em D1 (`usuario_id = usuario.id AND apagada IS NULL`) antes de qualquer acesso ao DO ou ao R2.
 * Conversa de outro usuário, inexistente, apagada ou com id malformado: 404 igual, para não revelar a existência.
 */
export async function autenticarConversa(req: Request, conversaId: string, injetado?: CloudflareEnv): Promise<RotaAutenticada | Response> {
  const e = env(injetado);
  const usuario = await usuarioAtual(req, e);
  if (!usuario) return negado();
  const conversa = await obterConversa(e, usuario.id, conversaId);
  if (!conversa) return naoEncontrada();
  return { usuario, conversa, env: e };
}

export const ehResposta = (x: unknown): x is Response => x instanceof Response;

/** Executa a rota e transforma exceção em 500 sem expor detalhe. O log leva só a classe do erro, nunca conteúdo do lead. */
export async function protegida(nome: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error("[api] falhou", { rota: nome, erro: e instanceof Error ? e.name : "desconhecido" });
    return erro(ERRO_INTERNO, 500);
  }
}
