/**
 * Identidade do assessor (plano, decisão D2).
 *
 * - Fora de produção: o usuário vem de `ATLAS_DEV_USUARIO` (padrão `dev@eqi.local`), e o cabeçalho `x-atlas-dev-usuario` o
 *   sobrepõe, para testar vários assessores localmente. Os dois são ignorados quando `ENVIRONMENT === "production"`.
 * - Em produção: Cloudflare Access na frente do Worker. A validação do JWT (`Cf-Access-Jwt-Assertion`: assinatura, `aud`, `exp`)
 *   fica atrás de `VerificadorAcesso` e ainda não tem implementação: o verificador padrão recusa tudo, então em produção toda
 *   rota responde 401 até alguém implementá-lo e chamar `definirVerificadorAcesso`. Um JWT que ninguém validou nunca vale.
 *
 * `id` é estável e derivado do e-mail (sha-256 truncado em 32 hex) enquanto não há o `sub` do Access. Quando houver, o
 * verificador devolve o `sub` como `id` e as linhas antigas ficam órfãs: migrar `usuarios.id` e os prefixos de R2 antes disso.
 */
import { env } from "./cf";
import { config } from "./config";

export interface Usuario {
  id: string;
  email: string;
}

/** Valida o JWT do Cloudflare Access e devolve a identidade, ou null se o token faltar ou não for válido. */
export interface VerificadorAcesso {
  verificar(req: Request, e: CloudflareEnv): Promise<Usuario | null>;
}

/** Padrão: ainda não implementado, recusa sempre (falha fechada). */
const verificadorPendente: VerificadorAcesso = { verificar: async () => null };

let verificador: VerificadorAcesso = verificadorPendente;

/** Ponto de extensão para a validação real do JWT do Access. */
export function definirVerificadorAcesso(v: VerificadorAcesso) {
  verificador = v;
}

const EMAIL = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/** E-mail em minúsculas se tiver formato válido (até 254 caracteres), senão null. */
export function emailValido(valor: string | null | undefined): string | null {
  const e = (valor ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** sha-256 do e-mail em minúsculas, truncado em 32 hex (128 bits). */
export async function idDoEmail(email: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(h).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cria a linha em `usuarios` no primeiro acesso. Não escreve nada se ela já existe (nenhuma linha afetada). */
async function garantirUsuario(db: D1Database, u: Usuario) {
  await db
    .prepare("INSERT INTO usuarios (id, email, criado) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(u.id, u.email, Date.now())
    .run();
}

/**
 * Usuário autenticado da requisição, ou null (a rota responde `negado()`). Cria a linha em `usuarios` no primeiro acesso.
 * Toda consulta de conversa filtra pelo `id` devolvido aqui, nunca por um id vindo do corpo ou da query.
 */
export async function usuarioAtual(req: Request, injetado?: CloudflareEnv): Promise<Usuario | null> {
  const e = env(injetado);
  const producao = (e.ENVIRONMENT ?? config.ambiente) === "production";
  let u: Usuario | null = null;
  if (producao) {
    u = await verificador.verificar(req, e);
  } else {
    const header = req.headers.get("x-atlas-dev-usuario");
    // Cabeçalho presente mas inválido não cai no usuário padrão: seria entrar como outra pessoa sem avisar.
    const email = emailValido(header !== null ? header : (e.ATLAS_DEV_USUARIO ?? "").trim() || config.devUsuario);
    if (email) u = { id: await idDoEmail(email), email };
  }
  if (!u) return null;
  await garantirUsuario(e.DB, u);
  return u;
}

export const negado = () => Response.json({ erro: "Acesso negado" }, { status: 401 });
