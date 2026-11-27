import { AVISO_SESSAO_EXPIRADA, conferirSessao } from "../sessao";
import { temPersonalizacao } from "./configPrompt";
import type { Anexo, CasoPublico, Contexto, ConversaResumo, Faixa, MensagemSalva, TarefaPublica } from "./types";

/** Erro de chamada à API. `mensagem` já vem em português, pronta para a tela (campo `erro` do servidor). */
export class ErroApi extends Error {
  constructor(public status: number, mensagem: string, public extra: Record<string, unknown> = {}) { super(mensagem); }
}

export const SEM_REDE = "Não consegui falar com o servidor. Tente de novo.";

function mensagemPadrao(status: number): string {
  if (status === 401) return "Sua sessão não é válida. Recarregue a página.";
  if (status === 404) return "Conversa não encontrada.";
  if (status === 409) return "O Atlas ainda está trabalhando nesta conversa.";
  return "Algo deu errado. Tente de novo.";
}

function erroDe(status: number, corpo: unknown): ErroApi {
  const j = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const msg = typeof j.erro === "string" && j.erro ? j.erro : mensagemPadrao(status);
  return new ErroApi(status, msg, j);
}

/** Erro de rede, ou a sessão do Access vencida (o redirect para o login aparece como falha de rede). A página recarrega sozinha. */
async function erroDeRede(): Promise<ErroApi> {
  return (await conferirSessao()) ? new ErroApi(401, AVISO_SESSAO_EXPIRADA) : new ErroApi(0, SEM_REDE);
}

/** Resposta de erro do servidor. Num 401 confere se a sessão venceu; se sim, o aviso troca a mensagem do servidor. */
async function erroDeResposta(status: number, corpo: unknown): Promise<ErroApi> {
  const e = erroDe(status, corpo);
  return status === 401 && (await conferirSessao()) ? new ErroApi(401, AVISO_SESSAO_EXPIRADA, e.extra) : e;
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try { r = await fetch(url, init); }
  catch (e) { if (init?.signal?.aborted) throw e; throw await erroDeRede(); }
  const corpo: unknown = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw await erroDeResposta(r.status, corpo);
  return corpo as T;
}

const json = (metodo: string, corpo: unknown): RequestInit => ({
  method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
});
const base = (id: string) => `/api/conversas/${encodeURIComponent(id)}`;

export interface DetalheConversa { conversa: ConversaResumo; caso: CasoPublico; tarefa: TarefaPublica | null; contexto: Contexto | null; alertasVistos: Faixa[]; configAtual: number }

export const listarConversas = (cursor?: string | null) =>
  chamar<{ itens: ConversaResumo[]; cursor: string | null }>(`/api/conversas${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

export const criarConversa = (titulo?: string) =>
  chamar<{ conversa: ConversaResumo; caso: CasoPublico }>("/api/conversas", json("POST", titulo ? { titulo } : {}));

export const obterConversa = (id: string) => chamar<DetalheConversa>(base(id));

export const marcarAlertaVisto = (id: string, alertaVisto: Faixa) =>
  chamar<{ conversa: ConversaResumo }>(base(id), json("PATCH", { alertaVisto }));

export const apagarConversa = (id: string) => chamar<null>(base(id), { method: "DELETE" });

export const listarMensagens = (id: string, opcoes: { antes?: number; limite?: number } = {}) => {
  const q = new URLSearchParams({ limite: String(opcoes.limite ?? 50) });
  if (opcoes.antes != null) q.set("antes", String(opcoes.antes));
  return chamar<{ itens: MensagemSalva[]; maisAntigas: boolean }>(`${base(id)}/mensagens?${q}`);
};

export const enviarMensagem = (id: string, corpo: { texto: string; anexos: string[]; idCliente: string }) =>
  chamar<{ mensagem: MensagemSalva; tarefa: TarefaPublica }>(`${base(id)}/mensagens`, json("POST", corpo));

export const gerarSlides = (id: string) =>
  chamar<{ tarefa: TarefaPublica }>(`${base(id)}/acoes`, json("POST", { acao: "gerar" }));

export const cancelarTarefa = (id: string) => chamar<{ ok: true }>(`${base(id)}/cancelar`, { method: "POST" });

export const urlEventos = (id: string) => `${base(id)}/eventos`;

/** Link de download de um deck. Prefere o link que o servidor mandou no resultado. */
export function urlDeck(conversaId: string, versao: number | undefined, fmt: "pptx" | "pdf", linkDoServidor?: string): string | null {
  if (linkDoServidor && /^(\/|https?:\/\/)/.test(linkDoServidor)) return linkDoServidor;
  return versao != null ? `${base(conversaId)}/decks/${versao}?fmt=${fmt}` : null;
}

/**
 * Envia um anexo (corpo = bytes) e informa o progresso do upload em porcentagem inteira.
 * Usa XMLHttpRequest porque o fetch ainda não informa progresso de envio.
 */
export function enviarAnexo(id: string, arquivo: File, aoProgredir: (pct: number) => void, sinal?: AbortSignal): Promise<Anexo> {
  return new Promise((resolve, reject) => {
    if (sinal?.aborted) return reject(new DOMException("Cancelado", "AbortError"));
    const xhr = new XMLHttpRequest();
    let ultimo = -1;
    xhr.open("PUT", `${base(id)}/anexos?nome=${encodeURIComponent(arquivo.name)}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.min(99, Math.floor((e.loaded / e.total) * 100)); // 100% só quando o servidor confirma
      if (pct !== ultimo) { ultimo = pct; aoProgredir(pct); }
    };
    xhr.onload = () => {
      let corpo: unknown = null;
      try { corpo = JSON.parse(xhr.responseText); } catch { /* sem corpo */ }
      if (xhr.status >= 200 && xhr.status < 300 && corpo && typeof corpo === "object" && "anexo" in corpo) {
        aoProgredir(100);
        resolve((corpo as { anexo: Anexo }).anexo);
      } else void erroDeResposta(xhr.status, corpo).then(reject);
    };
    xhr.onerror = () => void erroDeRede().then(reject);
    xhr.ontimeout = () => void erroDeRede().then(reject);
    const abortar = () => xhr.abort();
    xhr.onabort = () => reject(new DOMException("Cancelado", "AbortError"));
    sinal?.addEventListener("abort", abortar, { once: true });
    xhr.send(arquivo);
  });
}

export const ehCancelamento = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
export const textoDoErro = (e: unknown) => (e instanceof ErroApi ? e.message : SEM_REDE);

/**
 * Estado das instruções do assessor, para o ponto do ícone e para manter `configAtual` em dia ao voltar à aba.
 * Qualquer falha (inclusive 404, rota ausente) vira null: "sem personalização", sem erro na tela.
 */
export async function obterPersonalizacao(): Promise<{ versao: number; personalizada: boolean } | null> {
  try {
    const r = await fetch("/api/configuracoes/prompt", { cache: "no-store" });
    if (!r.ok) { if (r.status === 401) void conferirSessao(); return null; }
    const j: unknown = await r.json();
    const c = j && typeof j === "object" ? (j as { config?: { versao?: unknown; alterados?: Record<string, unknown>; extras?: { ativo: boolean }[] } }).config : undefined;
    if (!c || typeof c.versao !== "number") return null;
    return { versao: c.versao, personalizada: c.versao > 0 && temPersonalizacao(c) };
  } catch { void conferirSessao(); return null; }
}
