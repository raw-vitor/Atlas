import { afterEach, describe, expect, it, vi } from "vitest";
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => resposta(detail422, 422));
    await expect(renderizar({}, "pptx", "/tmp/x")).rejects.toThrow(/recusou o rascunho: frases literais do lead/);
    vi.stubGlobal("fetch", async () => resposta("boom", 500));
    await expect(renderizar({}, "pptx", "/tmp/x")).rejects.toThrow("deck-service 500: boom");
  });
});
