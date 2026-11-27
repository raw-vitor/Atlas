/**
 * Identidade para as páginas (Server Components), só para mostrar o e-mail e decidir se há "Sair".
 * Monta um `Request` mínimo com os cabeçalhos de identidade e chama `identificar`, que não grava em D1.
 * Nunca derruba nem redireciona a página: sem identidade, ou se a leitura falhar, devolve `email: null`.
 * Em produção o Cloudflare Access já barrou quem não pode entrar; fora dela sempre há o usuário de desenvolvimento.
 */
import { decodeJwt } from "jose";
import { headers } from "next/headers";
import { emProducao, identificar } from "./auth";

export interface IdentidadePagina {
  email: string | null;
  /** Mostra o link "Sair": `/cdn-cgi/access/logout` só existe atrás do Access, ou seja, em produção. */
  sair: boolean;
}

// Só o que `identificar` lê. Copiar tudo seria expor cookies e outros cabeçalhos a um código que não precisa deles.
const CABECALHOS = ["cf-access-jwt-assertion", "x-atlas-dev-usuario"];

export async function identidadeDaPagina(injetado?: CloudflareEnv): Promise<IdentidadePagina> {
  try {
    const h = await headers();
    const req = new Request("http://atlas.local/", { headers: Object.fromEntries(CABECALHOS.flatMap((n) => { const v = h.get(n); return v === null ? [] : [[n, v]]; })) });
    const u = await identificar(req, injetado);
    return { email: u?.email ?? null, sair: emProducao(injetado) };
  } catch {
    return { email: null, sair: false };
  }
}

/** Janela, contada a partir do login no Access, em que o chat ainda abre com a animação de entrada. */
const JANELA_ENTRADA_S = 60;

/**
 * true quando o JWT do Access foi emitido há menos de `JANELA_ENTRADA_S`: a página abriu logo depois do login e
 * mostra a entrada animada (components/atlas/Entrada.tsx). O `iat` é lido sem verificar a assinatura porque a decisão
 * é só visual; a identidade continua vindo de `identificar`. Sem JWT (fora de produção), devolve false.
 */
export async function acabouDeEntrar(agora = Date.now()): Promise<boolean> {
  try {
    const token = (await headers()).get("cf-access-jwt-assertion");
    if (!token) return false;
    const { iat } = decodeJwt(token);
    if (typeof iat !== "number") return false;
    const idade = agora / 1000 - iat;
    return idade > -5 && idade < JANELA_ENTRADA_S;
  } catch {
    return false;
  }
}
