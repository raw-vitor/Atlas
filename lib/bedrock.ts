/**
 * Cliente do Amazon Bedrock (Converse + structured output). Só roda no servidor.
 * - Com BEDROCK_API_KEY / AWS_BEARER_TOKEN_BEDROCK: fetch direto com Authorization: Bearer.
 * - Sem chave: SDK com as credenciais AWS padrão do ambiente.
 */
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { config } from "./config";
import { CanceladoError, checarCancelado, esperar, sinalAtual } from "./cancelamento";
import { canonico, schemaReduzido, validar, type SchemaName } from "./schemas";
import { msgRetry } from "./prompts";
import type { ChatJson } from "./steps";

export class LLMError extends Error {}
export interface Uso { chamadas: number; entrada: number; saida: number }
export const novoUso = (): Uso => ({ chamadas: 0, entrada: 0, saida: 0 });

type Msg = { role: "user" | "assistant"; content: ({ text: string } | { image: { format: string; source: { bytes: Uint8Array } } })[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = any;

let sdk: BedrockRuntimeClient | null = null;

async function converse(body: ConverseCommandInput, signal: AbortSignal): Promise<Resp> {
  if (config.apiKey) {
    const base = config.endpoint || `https://bedrock-runtime.${config.region}.amazonaws.com`;
    const url = `${base}/model/${encodeURIComponent(body.modelId!)}/converse`;
    const { modelId: _m, ...rest } = body;
    void _m;
    const json = JSON.stringify(rest, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v));
    const r = await fetch(url, {
      method: "POST", signal, body: json,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    });
    if (!r.ok) throw new LLMError(`Bedrock HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  sdk ??= new BedrockRuntimeClient({ region: config.region, ...(config.endpoint ? { endpoint: config.endpoint } : {}) });
  return sdk.send(new ConverseCommand(body), { abortSignal: signal });
}

function textoDe(resp: Resp): string {
  const parts = resp?.output?.message?.content ?? [];
  return parts.map((p: { text?: string }) => p.text ?? "").join("");
}

function contar(uso: Uso | undefined, resp: Resp) {
  if (!uso) return;
  uso.chamadas += 1;
  uso.entrada += resp?.usage?.inputTokens ?? 0;
  uso.saida += resp?.usage?.outputTokens ?? 0;
}

const MAX_TOKENS: Record<SchemaName, number> = {
  AtivosOut: 8000, Lead: 4000, Alocacao: 4000, Diagnostico: 6000, Decisao: 4000, Notas: 16000,
};

async function chamar(body: ConverseCommandInput): Promise<Resp> {
  checarCancelado();
  const externo = sinalAtual();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.llmTimeoutMs);
  const repassar = () => ac.abort();
  externo?.addEventListener("abort", repassar, { once: true });
  try { return await converse(body, ac.signal); }
  catch (e) { if (externo?.aborted) throw new CanceladoError(); throw e; }
  finally { clearTimeout(t); externo?.removeEventListener("abort", repassar); }
}

/** Equivalente a chat_json do Python: schema, temperatura e retry com a mesma mensagem. */
export function criarChatJson(uso?: Uso): ChatJson {
  return async <T,>(system: string, user: string, schema: SchemaName, temperature: number): Promise<T> => {
    const messages: Msg[] = [{ role: "user", content: [{ text: user }] }];
    let ultimo = "";
    for (let tentativa = 0; tentativa <= config.llmRetries; tentativa++) {
      let conteudo = "";
      try {
        const resp = await chamar({
          modelId: config.modelId,
          system: [{ text: system }],
          messages: messages as ConverseCommandInput["messages"],
          inferenceConfig: { temperature, maxTokens: MAX_TOKENS[schema] },
          outputConfig: {
            textFormat: {
              type: "json_schema",
              structure: { jsonSchema: { name: schema, schema: JSON.stringify(schemaReduzido(schema)) } },
            },
          },
        } as ConverseCommandInput);
        contar(uso, resp);
        conteudo = textoDe(resp);
        if (resp?.stopReason === "max_tokens") throw new SyntaxError("resposta cortada por limite de tokens");
        const dados = JSON.parse(conteudo);
        const erros = validar(schema, dados);
        if (erros.length) throw new TypeError("schema: " + erros.slice(0, 3).join("; "));
        return canonico<T>(dados, schema);
      } catch (e) {
        if (e instanceof CanceladoError) throw e;
        ultimo = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        const retentavel = e instanceof SyntaxError || e instanceof TypeError || e instanceof LLMError ||
          (e instanceof Error && (e.name === "AbortError" || /throttl|timeout|ServiceUnavailable|ModelTimeout|InternalServer/i.test(e.name + e.message)));
        if (!retentavel) throw new LLMError(`Falha ao chamar o Bedrock: ${ultimo}`);
        if (tentativa < config.llmRetries) {
          if (conteudo) messages.push({ role: "assistant", content: [{ text: conteudo }] });
          else if (messages[messages.length - 1].role === "user" && messages.length > 1) messages.pop();
          if (conteudo) messages.push({ role: "user", content: [{ text: msgRetry(ultimo) }] });
          else await esperar(1500 * (tentativa + 1));
        }
      }
    }
    throw new LLMError(`Falha ao obter JSON válido do modelo: ${ultimo}`);
  };
}

/** Transcrição de imagem de extrato com o mesmo modelo (bloco de imagem no Converse). */
export async function transcreverImagem(bytes: Uint8Array, formato: "png" | "jpeg" | "webp", prompt: string, uso?: Uso): Promise<string> {
  const resp = await chamar({
    modelId: config.modelId,
    messages: [{ role: "user", content: [{ image: { format: formato, source: { bytes } } }, { text: prompt }] }],
    inferenceConfig: { temperature: 0, maxTokens: 8000 },
  } as ConverseCommandInput);
  contar(uso, resp);
  return textoDe(resp);
}

/** Pergunta curta em JSON (usada na classificação de anexos). */
export async function perguntarJson(system: string, user: string, schema: object, uso?: Uso, maxTokens = 500): Promise<unknown> {
  const resp = await chamar({
    modelId: config.modelId, system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { temperature: 0, maxTokens },
    outputConfig: { textFormat: { type: "json_schema", structure: { jsonSchema: { name: "Resposta", schema: JSON.stringify(schema) } } } },
  } as ConverseCommandInput);
  contar(uso, resp);
  return JSON.parse(textoDe(resp));
}

export async function ping(): Promise<{ ok: boolean; modelo: string; regiao: string; auth: string; erro?: string }> {
  const base = { modelo: config.modelId, regiao: config.region, auth: config.apiKey ? "api-key" : "credenciais-aws" };
  try {
    const r = await perguntarJson("Responda só com o JSON pedido.", "Devolva ok=true.",
      { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false });
    return { ok: (r as { ok?: boolean }).ok === true, ...base };
  } catch (e) {
    return { ok: false, ...base, erro: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
