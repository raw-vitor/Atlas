import fs from "node:fs";
import path from "node:path";
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

export async function renderizar(payload: object, formato: "pptx" | "pdf", destino: string): Promise<void> {
  const r = await fetch(`${config.deckServiceUrl}/render`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, formato }), signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) {
    const corpo = await r.text();
    if (r.status === 422) {
      console.error("deck-service 422:", corpo.slice(0, 4000)); // o JSON completo fica só no log
      const msg = mensagem422(corpo);
      if (msg) throw new Error(msg);
    }
    throw new Error(`deck-service ${r.status}: ${corpo.slice(0, 300)}`);
  }
  fs.writeFileSync(path.join(destino), Buffer.from(await r.arrayBuffer()));
}

/** Confere se o serviço responde e se usa o mesmo schema que o Atlas (hash exportado por export_schemas.py). */
export async function deckSaude(): Promise<{ ok: boolean; erro?: string }> {
  try {
    const r = await fetch(`${config.deckServiceUrl}/health`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { schema_hash?: string };
    if (j.schema_hash !== constantes.SCHEMA_HASH)
      return { ok: false, erro: "o serviço do deck está com o schema desatualizado: reinicie o deck-service" };
    return { ok: true };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
}
