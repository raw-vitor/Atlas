/**
 * Identidade para as páginas (Server Components), só para mostrar o e-mail e decidir se há "Sair".
 * Monta um `Request` mínimo com os cabeçalhos de identidade e chama `identificar`, que não grava em D1.
 * Nunca derruba nem redireciona a página: sem identidade, ou se a leitura falhar, devolve `email: null`.
 * Em produção o Cloudflare Access já barrou quem não pode entrar; fora dela sempre há o usuário de desenvolvimento.
 */
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
