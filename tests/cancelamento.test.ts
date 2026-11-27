import { afterEach, describe, expect, it, vi } from "vitest";
import { CanceladoError, comCancelamento, esperar } from "../lib/cancelamento";
import { config } from "../lib/config";
import { criarChatJson } from "../lib/bedrock";
import * as jobs from "../lib/jobs";
import { respostaSSE } from "../lib/sse";
import { casoAvulso, copiarCaso, restaurarCaso } from "../lib/caso";

afterEach(() => vi.unstubAllGlobals());

/** fetch que só termina quando o sinal aborta, como uma chamada lenta ao Bedrock. */
function fetchPendente() {
  const chamadas = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", chamadas);
  return chamadas;
}

describe("cancelamento no Bedrock", () => {
  it("cancelar durante a chamada lança CanceladoError e não tenta de novo", async () => {
    const antes = config.apiKey;
    config.apiKey = "teste";
    try {
      const f = fetchPendente();
      const ac = new AbortController();
      const p = comCancelamento(ac.signal, () => criarChatJson()("s", "u", "Lead", 0));
      await new Promise((r) => setTimeout(r, 10));
      ac.abort();
      await expect(p).rejects.toBeInstanceOf(CanceladoError);
      expect(f).toHaveBeenCalledTimes(1);
    } finally { config.apiKey = antes; }
  });
  it("sinal já abortado não chama o Bedrock", async () => {
    const antes = config.apiKey;
    config.apiKey = "teste";
    try {
      const f = fetchPendente();
      const ac = new AbortController(); ac.abort();
      await expect(comCancelamento(ac.signal, () => criarChatJson()("s", "u", "Lead", 0))).rejects.toBeInstanceOf(CanceladoError);
      expect(f).not.toHaveBeenCalled();
    } finally { config.apiKey = antes; }
  });
  it("a espera entre tentativas termina na hora", async () => {
    const ac = new AbortController();
    const p = comCancelamento(ac.signal, () => esperar(60_000));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(CanceladoError);
  });
});

describe("jobs", () => {
  it("cancelar um job em execução termina em 'cancelado'", async () => {
    const j = jobs.novo();
    jobs.submeter(j, () => comCancelamento(j.ac.signal, () => esperar(60_000)).then(() => ({}) as never));
    await new Promise((r) => setTimeout(r, 10));
    expect(jobs.cancelar(j)).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(j.status).toBe("cancelado");
    expect(j.resultado).toBeNull();
  });
  it("cancelar um job que já terminou não muda nada", async () => {
    const j = jobs.novo();
    jobs.submeter(j, async () => ({ arquivos: {}, avisos: [], pendencias: [], resumo: { lead: "x", total: 1, perfil: "p" }, tokens: { chamadas: 0, entrada: 0, saida: 0, maiorEntrada: 0 } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(j.status).toBe("pronto");
    expect(jobs.cancelar(j)).toBe(false);
    expect(j.status).toBe("pronto");
  });
});

describe("respostaSSE", () => {
  it("fechar a conexão aborta o sinal entregue à função", async () => {
    let recebido: AbortSignal | undefined;
    const r = respostaSSE(async (_enviar, signal) => { recebido = signal; await new Promise((res) => signal.addEventListener("abort", () => res(null))); });
    const leitor = r.body!.getReader();
    await new Promise((res) => setTimeout(res, 10));
    expect(recebido?.aborted).toBe(false);
    await leitor.cancel();
    expect(recebido?.aborted).toBe(true);
  });
  it("o sinal da requisição também aborta", async () => {
    const req = new AbortController();
    let recebido: AbortSignal | undefined;
    respostaSSE(async (_e, signal) => { recebido = signal; await new Promise((res) => signal.addEventListener("abort", () => res(null))); }, req.signal);
    await new Promise((res) => setTimeout(res, 10));
    req.abort();
    expect(recebido?.aborted).toBe(true);
  });
});

describe("restaurarCaso", () => {
  it("desfaz fontes e campos criados depois da cópia", () => {
    const c = casoAvulso();
    const copia = copiarCaso(c);
    c.fontes.push({ nome: "a", papel: "carteira", origemPapel: "automatico", texto: "t", hash: "h" });
    c.assessor = "Luiz";
    restaurarCaso(c, copia);
    expect(c.fontes).toEqual([]);
    expect("assessor" in c).toBe(false);
  });
});
