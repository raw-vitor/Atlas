import { afterEach, describe, expect, it, vi } from "vitest";
import { CanceladoError, comCancelamento, esperar } from "../lib/cancelamento";
import { config } from "../lib/config";
import { criarChatJson } from "../lib/bedrock";
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
