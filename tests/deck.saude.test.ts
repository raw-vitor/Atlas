import { afterEach, describe, expect, it, vi } from "vitest";
import { CanceladoError, comCancelamento } from "../lib/cancelamento";
import constantes from "../lib/schemas/constantes.json";
import { deckSaude, mensagem422, renderizar } from "../lib/deck";

const resposta = (corpo: unknown, status = 200) => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });
afterEach(() => vi.unstubAllGlobals());

describe("deckSaude", () => {
  it("ok quando o hash do schema é o mesmo", async () => {
    vi.stubGlobal("fetch", async () => resposta({ ok: true, schema_hash: constantes.SCHEMA_HASH }));
    expect(await deckSaude()).toEqual({ ok: true });
  });
  it("recusa hash diferente", async () => {
    vi.stubGlobal("fetch", async () => resposta({ ok: true, schema_hash: "outro" }));
    const r = await deckSaude();
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("desatualizado");
  });
  it("recusa serviço antigo, sem hash no /health", async () => {
    vi.stubGlobal("fetch", async () => resposta({ ok: true }));
    expect((await deckSaude()).ok).toBe(false);
  });
  it("erro de rede e HTTP não-200", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("ECONNREFUSED"); });
    expect(await deckSaude()).toEqual({ ok: false, erro: "ECONNREFUSED" });
    vi.stubGlobal("fetch", async () => resposta("", 500));
    expect(await deckSaude()).toEqual({ ok: false, erro: "HTTP 500" });
  });
});

const detail422 = JSON.stringify({ detail: [
  { type: "too_short", loc: ["body", "lead", "frases_literais"], msg: "List should have at least 3 items", ctx: { min_length: 3, actual_length: 0 } },
  { type: "too_short", loc: ["body", "diag", "disse"], msg: "List should have at least 3 items", ctx: { min_length: 3, actual_length: 0 } },
] });

describe("mensagem422", () => {
  it("traduz os campos e mostra o que veio e o que se exige", () => {
    const m = mensagem422(detail422)!;
    expect(m).toContain("frases literais do lead (veio 0, exige ao menos 3)");
    expect(m).toContain("O que você disse × os números");
    expect(m).not.toContain("{");
  });
  it("campo sem rótulo mostra o caminho técnico; corpo inválido devolve null", () => {
    const m = mensagem422(JSON.stringify({ detail: [{ loc: ["body", "lead", "perfil", "x"], msg: "campo inválido" }] }))!;
    expect(m).toContain("lead.perfil.x (campo inválido)");
    expect(mensagem422("<html>")).toBeNull();
    expect(mensagem422("{}")).toBeNull();
  });
  it("renderizar usa a mensagem legível no 422 e o texto cru nos outros erros", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => resposta(detail422, 422));
    await expect(renderizar({}, "pptx")).rejects.toThrow(/recusou o rascunho: frases literais do lead/);
    // O log leva só o que mensagem422 extrai (campos e tamanhos), nunca o corpo cru, que cita trechos do lead.
    expect(JSON.stringify(log.mock.calls)).not.toContain("loc");
    vi.stubGlobal("fetch", async () => resposta("boom", 500));
    await expect(renderizar({}, "pptx")).rejects.toThrow("deck-service 500: boom");
    log.mockRestore();
  });
});

/** O binding `DECK` do Worker: um Container por Durable Object. Aqui, um dublê com a mesma interface. */
function envComDeck(responder: (req: Request) => Promise<Response> | Response) {
  const pedidos: { url: string; metodo: string; corpo: string; instancia: string }[] = [];
  const DECK = {
    idFromName: (n: string) => n,
    get: (id: string) => ({
      async fetch(req: Request) {
        pedidos.push({ url: req.url, metodo: req.method, corpo: req.method === "POST" ? await req.clone().text() : "", instancia: id });
        return responder(req);
      },
    }),
  };
  return { env: { DECK } as unknown as CloudflareEnv, pedidos };
}

describe("deck no Container (binding DECK)", () => {
  it("deckSaude pergunta ao Container e não ao DECK_SERVICE_URL", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("não deveria usar a rede"); });
    const { env, pedidos } = envComDeck(() => resposta({ ok: true, schema_hash: constantes.SCHEMA_HASH }));
    expect(await deckSaude(env)).toEqual({ ok: true });
    expect(pedidos).toEqual([{ url: "http://deck/health", metodo: "GET", corpo: "", instancia: "pool-0" }]);
  });

  it("renderizar manda o formato junto do payload e devolve os bytes do arquivo", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("não deveria usar a rede"); });
    const { env, pedidos } = envComDeck(() => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 }));
    const bytes = await renderizar({ nome_arquivo: "x" }, "pptx", env);
    expect([...new Uint8Array(bytes)]).toEqual([0x50, 0x4b, 3, 4]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ url: "http://deck/render", metodo: "POST" });
    expect(JSON.parse(pedidos[0].corpo)).toEqual({ nome_arquivo: "x", formato: "pptx" });
  });

  it("Container fora do ar: deckSaude devolve o erro e renderizar lança", async () => {
    const { env } = envComDeck(() => { throw new Error("container indisponível"); });
    expect(await deckSaude(env)).toEqual({ ok: false, erro: "container indisponível" });
    await expect(renderizar({}, "pdf", env)).rejects.toThrow("container indisponível");
  });

  it("cancelar durante a renderização corta o pedido ao Container e lança CanceladoError", async () => {
    const { env, pedidos } = envComDeck((req) => new Promise<Response>((_ok, falha) =>
      req.signal.addEventListener("abort", () => falha(new DOMException("aborted", "AbortError")))));
    const ac = new AbortController();
    const p = comCancelamento(ac.signal, () => renderizar({}, "pptx", env));
    await vi.waitFor(() => expect(pedidos).toHaveLength(1));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(CanceladoError);
  });
});
