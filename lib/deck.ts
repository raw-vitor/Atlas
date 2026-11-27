import { CanceladoError, sinalAtual } from "./cancelamento";
import { env as ambiente } from "./cf";
import { config } from "./config";
import constantes from "./schemas/constantes.json";

/** Nomes dos campos do rascunho como o usuário os conhece. O que não estiver aqui aparece com o caminho técnico. */
const ROTULOS: Record<string, string> = {
  "lead.frases_literais": "frases literais do lead",
  "lead.situacao": "situação do lead",
  "lead.objetivos": "objetivos do lead",
  "lead.restricoes": "restrições do lead",
  "diag.disse": "slide “O que você disse × os números”",
  "diag.acertos": "slide “O que você acertou”",
  "diag.riscos": "slide de riscos",
  "diag.falta": "slide “O que falta”",
  "diag.perguntas": "perguntas",
  "aloc.cards": "cards da alocação",
  "aloc.fases": "fases da alocação",
  "dec.garantias": "garantias da decisão",
  "dec.condicoes": "condições da decisão",
  "dec.resumo_itens": "itens do resumo",
};

interface Erro422 { loc?: unknown[]; msg?: string; ctx?: { actual_length?: number; min_length?: number } }

/** Texto para o chat a partir do `detail` de um 422 do FastAPI. Devolve null se o corpo não tiver esse formato. */
export function mensagem422(corpo: string): string | null {
  let detail: unknown;
  try { detail = (JSON.parse(corpo) as { detail?: unknown }).detail; } catch { return null; }
  if (!Array.isArray(detail) || !detail.length) return null;
  const campos = (detail as Erro422[]).slice(0, 5).map((e) => {
    const loc = (e.loc ?? []).filter((x) => x !== "body");
    const campo = loc.filter((x) => typeof x === "string").slice(0, 2).join(".");
    const nome = ROTULOS[campo] ?? loc.join(".");
    const { actual_length: veio, min_length: min } = e.ctx ?? {};
    return veio !== undefined && min !== undefined ? `${nome} (veio ${veio}, exige ao menos ${min})` : `${nome} (${e.msg ?? "inválido"})`;
  });
  return `O serviço do deck recusou o rascunho: ${campos.join("; ")}. Provável serviço desatualizado. Avise o time.`;
}

const sinalDeck = () => { const ext = sinalAtual(); const t = AbortSignal.timeout(300_000); return ext ? AbortSignal.any([ext, t]) : t; };

/** Instância única do Container: o deck já é sequencial por caso, e `max_instances` só vale em produção. */
const INSTANCIA_DECK = "pool-0";

/**
 * Chama o deck-service. No Worker (e em `wrangler dev`) é o Container do binding `DECK`; sem o binding (testes em Node, `next dev`)
 * cai no `DECK_SERVICE_URL`, o mesmo serviço Python do docker-compose. `injetado` é o env dos testes e da rota de ações.
 */
async function pedirDeck(caminho: string, init: RequestInit, injetado?: CloudflareEnv): Promise<Response> {
  let ns: CloudflareEnv["DECK"] | undefined;
  try { ns = ambiente(injetado).DECK; } catch { ns = undefined; } // fora de um contexto do Worker (Node puro)
  if (!ns) return fetch(`${config.deckServiceUrl}${caminho}`, init);
  return ns.get(ns.idFromName(INSTANCIA_DECK)).fetch(new Request(`http://deck${caminho}`, init));
}

/** Corpo do deck-service para um formato. Lança CanceladoError se o fluxo foi cancelado durante a chamada. */
export async function renderizar(payload: object, formato: "pptx" | "pdf", injetado?: CloudflareEnv): Promise<ArrayBuffer> {
  const ext = sinalAtual();
  let r: Response;
  try {
    r = await pedirDeck("/render", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, formato }), signal: sinalDeck(),
    }, injetado);
  } catch (e) { if (ext?.aborted) throw new CanceladoError(); throw e; }
  if (!r.ok) {
    const corpo = await r.text();
    if (r.status === 422) {
      const msg = mensagem422(corpo); // só nomes de campos e tamanhos; o corpo cru cita trechos do lead e não vai para o log
      console.error("deck-service 422:", msg ?? "corpo sem o formato esperado");
      if (msg) throw new Error(msg);
    }
    throw new Error(`deck-service ${r.status}: ${corpo.slice(0, 300)}`);
  }
  try { return await r.arrayBuffer(); } catch (e) { if (ext?.aborted) throw new CanceladoError(); throw e; }
}

/** Confere se o serviço responde e se usa o mesmo schema que o Atlas (hash exportado por export_schemas.py). */
export async function deckSaude(injetado?: CloudflareEnv): Promise<{ ok: boolean; erro?: string }> {
  try {
    const r = await pedirDeck("/health", { signal: AbortSignal.timeout(4000) }, injetado);
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { schema_hash?: string };
    if (j.schema_hash !== constantes.SCHEMA_HASH)
      return { ok: false, erro: "o serviço do deck está com o schema desatualizado: reinicie o deck-service" };
    return { ok: true };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
}
