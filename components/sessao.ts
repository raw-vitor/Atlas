/**
 * Sessão vencida do Cloudflare Access (plano de login, seção 4.3).
 *
 * Com a sessão vencida, o Access responde a qualquer requisição com um redirect para a tela de login do provedor de identidade.
 * Um `fetch` same-origin que segue esse redirect falha por CORS (TypeError) e nunca chega a dar 401. Por isso, depois de um erro
 * de rede (ou de um 401), `conferirSessao` pergunta a uma rota leve com `redirect: "manual"`: `opaqueredirect` ou 401 = vencida.
 * Qualquer outra resposta, ou falha ao perguntar, é erro de rede comum e quem chamou segue com o tratamento que já tinha.
 */

export const AVISO_SESSAO_EXPIRADA = "Sua sessão expirou. Entrando de novo…";

/** Tempo para ler o aviso antes de a página recarregar e cair na tela de login. */
export const ESPERA_RECARGA_MS = 1500;

// Uma recarga só por carregamento de página: várias chamadas em paralelo (SSE, upload, fetch) não recarregam várias vezes
// nem entram em loop se o login devolver a página com a sessão ainda inválida.
let recarregando = false;

/** Devolve `true` se a sessão venceu (e já agendou a recarga da página). Nunca rejeita. */
export async function conferirSessao(): Promise<boolean> {
  if (recarregando) return true;
  let vencida = false;
  try {
    const r = await fetch("/api/health", { redirect: "manual", cache: "no-store" });
    vencida = r.type === "opaqueredirect" || r.status === 401;
  } catch {
    return false;
  }
  if (!vencida) return false;
  if (!recarregando) {
    recarregando = true;
    setTimeout(() => { if (typeof window !== "undefined") window.location.reload(); }, ESPERA_RECARGA_MS);
  }
  return true;
}

/** Só para os testes: volta ao estado de página recém-carregada. */
export function _reiniciarSessao() { recarregando = false; }
