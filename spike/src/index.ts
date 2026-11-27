// Worker descartável da fase 0: exercita no runtime do Workers o que o Atlas usa hoje em Node.
// Nada aqui vai para produção. Nunca devolve conteúdo extraído (só tamanhos), salvo ?amostra=1 com fixtures sintéticos.
import { toText } from "../../lib/ingest";
import { comCancelamento, checarCancelado, esperar, sinalAtual, CanceladoError } from "../../lib/cancelamento";
import { ping, perguntarJson, novoUso } from "../../lib/bedrock";
import { config } from "../../lib/config";
import { validar, canonico } from "../../lib/schemas";

const json = (o: unknown, status = 200) => Response.json(o, { status });
const msg = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 400) : String(e));

async function testarCancelamento() {
  const r: Record<string, unknown> = {};
  // 1) o sinal atravessa awaits e timers dentro do fluxo
  const ac1 = new AbortController();
  r.sinalVisivelAposAwait = await comCancelamento(ac1.signal, async () => {
    await new Promise((res) => setTimeout(res, 5));
    await Promise.resolve();
    return sinalAtual() === ac1.signal;
  });
  // 2) abortar durante esperar() rejeita com CanceladoError
  const ac2 = new AbortController();
  r.abortDuranteEsperar = await comCancelamento(ac2.signal, async () => {
    setTimeout(() => ac2.abort(), 20);
    try { await esperar(2000); return "não cancelou"; } catch (e) { return e instanceof CanceladoError ? "CanceladoError" : msg(e); }
  });
  // 3) dois fluxos concorrentes não se misturam
  const a = new AbortController(), b = new AbortController();
  const [ra, rb] = await Promise.all([
    comCancelamento(a.signal, async () => { await esperar(30); return sinalAtual() === a.signal; }),
    comCancelamento(b.signal, async () => { await esperar(10); return sinalAtual() === b.signal; }),
  ]);
  r.isolamentoEntreFluxos = ra && rb;
  // 4) checarCancelado lança com sinal já abortado
  const ac4 = new AbortController(); ac4.abort();
  r.checarComSinalAbortado = comCancelamento(ac4.signal, () => { try { checarCancelado(); return "não lançou"; } catch (e) { return e instanceof CanceladoError ? "CanceladoError" : msg(e); } });
  return r;
}

async function testarBedrock(url: URL) {
  const base = { chaveConfigurada: Boolean(config.apiKey), modelo: config.modelId, regiao: config.region };
  if (!config.apiKey) return { ...base, status: "não testado: sem BEDROCK_API_KEY/AWS_BEARER_TOKEN_BEDROCK" };
  const t0 = Date.now();
  if (url.searchParams.get("cancelar") === "1") {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    // ping() captura o erro e devolve { ok: false, erro }; a mensagem de CanceladoError prova que o fetch foi abortado
    try {
      const r = await comCancelamento(ac.signal, () => ping());
      return { ...base, cancelamento: !r.ok && /Cancelado pelo assessor/.test(r.erro ?? "") ? "fetch em andamento abortado (CanceladoError)" : "não cancelou", ms: Date.now() - t0 };
    } catch (e) { return { ...base, cancelamento: e instanceof CanceladoError ? "CanceladoError" : msg(e) }; }
  }
  const r = await ping();
  // segunda chamada com Uso para registrar o usage.inputTokens real devolvido pelo Bedrock (base do medidor, D4)
  const uso = novoUso();
  try { await perguntarJson("Responda só com o JSON pedido.", "Devolva ok=true.", { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, uso); }
  catch (e) { return { ...base, ...r, usoErro: msg(e) }; }
  return { ...base, ...r, uso, ms: Date.now() - t0 };
}

function testarSchemas() {
  const r: Record<string, unknown> = {};
  try {
    const erros = validar("Decisao", { hoje_numero: "1" });
    r.ajvValidar = { ok: true, errosEsperados: erros.length };
    r.canonico = typeof canonico === "function" ? "importado" : "ausente";
  } catch (e) { r.ajvValidar = { ok: false, erro: msg(e) }; }
  return r;
}

function info() {
  const r: Record<string, unknown> = {
    processEnvPopulado: { BEDROCK_API_KEY: Boolean(process.env.BEDROCK_API_KEY), BEDROCK_REGION: process.env.BEDROCK_REGION ?? null },
    versoes: (process as unknown as { versions?: Record<string, string> }).versions ?? null,
  };
  try { r.memoryUsage = process.memoryUsage(); } catch (e) { r.memoryUsage = msg(e); }
  try { r.performanceMemory = (performance as unknown as { memory?: unknown }).memory ?? "ausente"; } catch (e) { r.performanceMemory = msg(e); }
  try { r.newFunction = String(new Function("return 1+1")()); } catch (e) { r.newFunction = msg(e); }
  return r;
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/info") return json(info());
      if (url.pathname === "/cancelamento") return json(await testarCancelamento());
      if (url.pathname === "/schemas") return json(testarSchemas());
      if (url.pathname === "/bedrock") return json(await testarBedrock(url));
      if (url.pathname === "/extrair" && req.method === "POST") {
        const nome = url.searchParams.get("nome") ?? "arquivo.txt";
        const ab = await req.arrayBuffer();
        const txt = await toText(nome, Buffer.from(ab));
        return json({ ok: true, nome, bytes: ab.byteLength, chars: txt.length, ...(url.searchParams.get("amostra") === "1" ? { inicio: txt.slice(0, 60) } : {}) });
      }
      return json({ rotas: ["/info", "/cancelamento", "/schemas", "/bedrock[?cancelar=1]", "POST /extrair?nome=x.ext[&amostra=1]"] }, 404);
    } catch (e) {
      return json({ ok: false, erro: msg(e) }, 500);
    }
  },
};
