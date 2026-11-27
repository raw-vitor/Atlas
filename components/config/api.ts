import type { CorpoPut, RespostaConfig } from "@/lib/prompt-tipos";

/**
 * Erro de chamada à API de configuração. `mensagem` já vem em português, pronta para a tela.
 * No 409, `atual` traz a configuração que está no servidor, para a tela oferecer "Recarregar".
 */
export class ErroConfig extends Error {
  constructor(public status: number, mensagem: string, public atual: RespostaConfig | null = null) { super(mensagem); }
}

export const SEM_REDE = "Não consegui falar com o servidor. Tente de novo.";
export const MUDOU_EM_OUTRA_ABA = "Esta configuração mudou em outra aba.";

const URL = "/api/configuracoes/prompt";

function mensagemPadrao(status: number): string {
  if (status === 401) return "Sua sessão não é válida. Recarregue a página.";
  if (status === 409) return MUDOU_EM_OUTRA_ABA;
  if (status === 400) return "O servidor não aceitou estas instruções. Confira os textos e tente de novo.";
  return "Algo deu errado. Tente de novo.";
}

function valida(r: unknown): r is RespostaConfig {
  const o = r as Partial<RespostaConfig> | null;
  return !!o && Array.isArray(o.categorias) && Array.isArray(o.blocos) && !!o.config && typeof o.config.versao === "number"
    && !!o.config.alterados && Array.isArray(o.config.extras);
}

async function chamar(init?: RequestInit): Promise<RespostaConfig> {
  let r: Response;
  try { r = await fetch(URL, { cache: "no-store", ...init }); }
  catch { throw new ErroConfig(0, SEM_REDE); }
  const corpo: unknown = await r.json().catch(() => null);
  const j = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  if (!r.ok) {
    const msg = typeof j.erro === "string" && j.erro ? j.erro : mensagemPadrao(r.status);
    throw new ErroConfig(r.status, msg, r.status === 409 && valida(j.atual) ? j.atual : null);
  }
  if (!valida(corpo)) throw new ErroConfig(r.status, "Resposta inesperada do servidor. Tente de novo.");
  return corpo;
}

export const obterConfig = () => chamar();

export const salvarConfig = (corpo: CorpoPut) =>
  chamar({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

/** Restaurar tudo ao original: a config volta vazia, com a versão seguinte. */
export const restaurarTudo = () => chamar({ method: "DELETE" });
