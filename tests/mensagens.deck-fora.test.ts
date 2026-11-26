/** Com o deck-service fora do ar ou desatualizado, a rota de mensagens recusa antes de qualquer chamada à LLM. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { novoCaso } from "../lib/caso";
import { POST } from "../app/api/conversas/[id]/mensagens/route";

afterEach(() => vi.unstubAllGlobals());

async function enviar(id: string) {
  const fd = new FormData();
  fd.set("message", "segue a carteira");
  fd.append("files", new File(["CDB XP 103% CDI 450.000,00"], "extrato.txt"));
  return POST(new Request("http://x/api/conversas/" + id + "/mensagens", { method: "POST", body: fd }),
    { params: Promise.resolve({ id }) } as never);
}

describe("POST /api/conversas/[id]/mensagens com o deck-service indisponível", () => {
  it("responde 503 e só consulta o /health", async () => {
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => { chamadas.push(String(u)); throw new Error("ECONNREFUSED"); });
    const caso = novoCaso();
    const r = await enviar(caso.id);
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toContain("Não enviei nada para análise");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(/\/health$/);
    expect(caso.ocupado).toBeFalsy();
  });
  it("responde 503 também com o serviço desatualizado", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await enviar(novoCaso().id);
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toContain("desatualizado");
  });
});
