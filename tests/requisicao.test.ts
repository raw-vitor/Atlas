import { afterEach, describe, expect, it } from "vitest";
import { requisicaoDoIsolate } from "../lib/requisicao";

const RequestNativo = globalThis.Request;

afterEach(() => { globalThis.Request = RequestNativo; });

describe("requisicaoDoIsolate", () => {
  it("com o Request global trocado por uma subclasse (OpenNext), o pedido nativo volta a ser instanceof Request e mantém corpo e cabeçalhos", async () => {
    const nativo = new RequestNativo("http://extrator/extrair?nome=a.pdf", { method: "POST", headers: { "x-a": "1" }, body: "conteudo" });
    class CustomRequest extends RequestNativo {}
    globalThis.Request = CustomRequest as typeof Request;
    expect(nativo instanceof Request).toBe(false); // o defeito: o Container trataria isto como URL
    const r = requisicaoDoIsolate(nativo);
    expect(r instanceof Request).toBe(true);
    expect(r.url).toBe("http://extrator/extrair?nome=a.pdf");
    expect(r.method).toBe("POST");
    expect(r.headers.get("x-a")).toBe("1");
    expect(await r.text()).toBe("conteudo");
  });

  it("com o Request nativo devolve o mesmo objeto", () => {
    const r = new Request("http://deck/health");
    expect(requisicaoDoIsolate(r)).toBe(r);
  });
});
