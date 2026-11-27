/**
 * Identidade do assessor (plano de login via Cloudflare Access, A1 a A9).
 *
 * - Fora de produção: o usuário vem de `ATLAS_DEV_USUARIO` (padrão `dev@eqi.local`), e o cabeçalho `x-atlas-dev-usuario` o
 *   sobrepõe, para testar vários assessores localmente. Os dois são ignorados quando `ENVIRONMENT === "production"`.
 * - Em produção: o Cloudflare Access fica na frente do Worker e repassa o JWT em `Cf-Access-Jwt-Assertion`. `verificadorAccess`
 *   confere assinatura (RS256, chaves do team domain), `iss`, `aud`, `exp` e `nbf`, e tira o e-mail do claim `email`. Sem
 *   `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`, sem token ou com token inválido o resultado é null e a rota responde 401 (falha fechada).
 *   Um JWT que ninguém validou nunca vale. Quem entra é decidido só pela política do Access; o Worker não repete a regra.
 *
 * `id` é estável e derivado do e-mail (sha-256 truncado em 32 hex). O `sub` do Access não é usado: trocar o id deixaria órfãos
 * `conversas.usuario_id`, `config_prompt.usuario_id` e os prefixos `u/<id>/` do R2 (A4).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
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

// Um JWKS por team domain, criado sob demanda (lib/cf.ts: nada de env no nível do módulo). O jose guarda as chaves em cache no
// isolate e rebusca quando aparece um `kid` desconhecido (rotação a cada 6 semanas); nenhuma chave é fixada no código.
const jwks = new Map<string, JWTVerifyGetKey>();

function chaves(team: string): JWTVerifyGetKey {
  let k = jwks.get(team);
  if (!k) {
    k = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwks.set(team, k);
  }
  return k;
}

/**
 * Verificador do Cloudflare Access. `obterChaves` troca a busca das chaves públicas (os testes passam um `createLocalJWKSet`).
 * Token de service token (sem `email`) é recusado: o Atlas não tem cliente máquina a máquina.
 */
export function verificadorAccess(obterChaves: (team: string) => JWTVerifyGetKey = chaves): VerificadorAcesso {
  return {
    async verificar(req, e) {
      const team = e.ACCESS_TEAM_DOMAIN?.trim().replace(/\/+$/, "");
      const aud = e.ACCESS_AUD?.trim();
      const token = req.headers.get("cf-access-jwt-assertion");
      if (!team || !aud || !token) return null; // A9
      try {
        const { payload } = await jwtVerify(token, obterChaves(team), { issuer: team, audience: aud, algorithms: ["RS256"] });
        const email = emailValido(typeof payload.email === "string" ? payload.email : null);
        return email ? { id: await idDoEmail(email), email } : null;
      } catch {
        return null;
      }
    },
  };
}

let verificador: VerificadorAcesso = verificadorAccess();

/** Troca o verificador (testes). Em produção o padrão é `verificadorAccess()`. */
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

/** `true` se `ENVIRONMENT` (ou o padrão da config) é "production": só o JWT do Access vale. */
export function emProducao(injetado?: CloudflareEnv): boolean {
  const e = env(injetado);
  return (e.ENVIRONMENT ?? config.ambiente) === "production";
}

/**
 * Identidade da requisição, sem tocar em D1 (as páginas Server Component usam só para mostrar o e-mail). Em produção, o JWT do
 * Access validado; fora, o cabeçalho de desenvolvimento ou `ATLAS_DEV_USUARIO`. Devolve null se não houver identidade válida.
 */
export async function identificar(req: Request, injetado?: CloudflareEnv): Promise<Usuario | null> {
  const e = env(injetado);
  if (emProducao(e)) return verificador.verificar(req, e);
  const header = req.headers.get("x-atlas-dev-usuario");
  // Cabeçalho presente mas inválido não cai no usuário padrão: seria entrar como outra pessoa sem avisar.
  const email = emailValido(header !== null ? header : (e.ATLAS_DEV_USUARIO ?? "").trim() || config.devUsuario);
  return email ? { id: await idDoEmail(email), email } : null;
}

/**
 * Usuário autenticado da requisição, ou null (a rota responde `negado()`). Cria a linha em `usuarios` no primeiro acesso.
 * Toda consulta de conversa filtra pelo `id` devolvido aqui, nunca por um id vindo do corpo ou da query.
 */
export async function usuarioAtual(req: Request, injetado?: CloudflareEnv): Promise<Usuario | null> {
  const e = env(injetado);
  const u = await identificar(req, e);
  if (!u) return null;
  await garantirUsuario(e.DB, u);
  return u;
}

export const negado = () => Response.json({ erro: "Acesso negado" }, { status: 401 });
