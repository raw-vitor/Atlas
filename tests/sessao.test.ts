import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroApi, enviarAnexo, listarConversas, obterPersonalizacao } from "@/components/chat/api";
import { criarGerenciadorEventos, type FonteEventos } from "@/components/chat/eventos";
import { ErroConfig, obterConfig } from "@/components/config/api";
import { AVISO_SESSAO_EXPIRADA, ESPERA_RECARGA_MS, _reiniciarSessao, conferirSessao } from "@/components/sessao";

const reload = vi.fn();
const resposta = (p: { status?: number; type?: ResponseType }) => ({ status: p.status ?? 200, type: p.type ?? "basic" }) as Response;
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const redirectOpaco = () => resposta({ status: 0, type: "opaqueredirect" });

/** `fetch` que atende a conferência (`/api/health`) com `saude` e as demais rotas com `outras`. */
function simularRede(saude: () => Promise<Response>, outras: () => Promise<Response> = async () => { throw new TypeError("Failed to fetch"); }) {
  const f = vi.fn((url: string) => (url === "/api/health" ? saude() : outras()));
  vi.stubGlobal("fetch", f);
  return f;
}
const chamadasSaude = (f: ReturnType<typeof simularRede>) => f.mock.calls.filter((c) => c[0] === "/api/health");

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  _reiniciarSessao();
  vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("conferirSessao", () => {
  it("pergunta a /api/health sem seguir redirect nem usar cache", async () => {
    const f = simularRede(async () => resposta({ status: 200 }));
    await conferirSessao();
    expect(f).toHaveBeenCalledWith("/api/health", { redirect: "manual", cache: "no-store" });
  });

  it("opaqueredirect: sessão vencida, recarrega a página depois de a pessoa poder ler o aviso", async () => {
    simularRede(async () => redirectOpaco());
    expect(await conferirSessao()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("401: sessão vencida", async () => {
    simularRede(async () => resposta({ status: 401 }));
    expect(await conferirSessao()).toBe(true);
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("200: sessão válida, não recarrega", async () => {
    simularRede(async () => resposta({ status: 200 }));
    expect(await conferirSessao()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("503 (Bedrock ou deck fora) e 403 não são sessão vencida", async () => {
    for (const status of [503, 403, 500]) {
      simularRede(async () => resposta({ status }));
      expect(await conferirSessao()).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("erro de rede ao conferir: erro comum, não recarrega e não rejeita", async () => {
    simularRede(async () => { throw new TypeError("Failed to fetch"); });
    expect(await conferirSessao()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
    // E volta a conferir na próxima vez (não ficou travada).
    simularRede(async () => redirectOpaco());
    expect(await conferirSessao()).toBe(true);
  });

  it("chamadas em paralelo recarregam uma vez só", async () => {
    simularRede(async () => redirectOpaco());
    const r = await Promise.all([conferirSessao(), conferirSessao(), conferirSessao()]);
    expect(r).toEqual([true, true, true]);
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS * 5);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("depois de agendar a recarga, chamadas novas não perguntam de novo nem recarregam outra vez", async () => {
    const f = simularRede(async () => resposta({ status: 401 }));
    await conferirSessao();
    expect(await conferirSessao()).toBe(true);
    expect(chamadasSaude(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS * 5);
    expect(await conferirSessao()).toBe(true); // a página ainda não terminou de recarregar
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS * 5);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chamadasSaude(f)).toHaveLength(1);
  });
});

describe("clientes da API com a sessão vencida", () => {
  it("chat: erro de rede com sessão vencida vira o aviso de sessão e recarrega", async () => {
    simularRede(async () => redirectOpaco());
    const e = await listarConversas().catch((x) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 401, message: AVISO_SESSAO_EXPIRADA });
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("chat: erro de rede com sessão válida mantém a mensagem de rede", async () => {
    simularRede(async () => resposta({ status: 200 }));
    expect(await listarConversas().catch((x) => x)).toMatchObject({ status: 0, message: "Não consegui falar com o servidor. Tente de novo." });
    expect(reload).not.toHaveBeenCalled();
  });

  it("chat: 401 confirmado pela conferência mostra o aviso; 401 com a sessão válida mantém a mensagem do servidor", async () => {
    simularRede(async () => resposta({ status: 401 }), async () => json(401, { erro: "Acesso negado" }));
    expect(await listarConversas().catch((x) => x)).toMatchObject({ status: 401, message: AVISO_SESSAO_EXPIRADA });
    _reiniciarSessao();
    simularRede(async () => resposta({ status: 200 }), async () => json(401, { erro: "Acesso negado" }));
    expect(await listarConversas().catch((x) => x)).toMatchObject({ status: 401, message: "Acesso negado" });
  });

  it("chat: outros erros (404, 409, 500) não conferem a sessão", async () => {
    const f = simularRede(async () => resposta({ status: 200 }), async () => json(409, { erro: "Ocupada" }));
    expect(await listarConversas().catch((x) => x)).toMatchObject({ status: 409, message: "Ocupada" });
    expect(chamadasSaude(f)).toHaveLength(0);
  });

  it("chat: obterPersonalizacao continua devolvendo null e dispara a conferência", async () => {
    simularRede(async () => redirectOpaco());
    expect(await obterPersonalizacao()).toBeNull();
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("configurações: erro de rede e 401 usam o aviso quando a sessão venceu", async () => {
    simularRede(async () => redirectOpaco());
    expect(await obterConfig().catch((x) => x)).toMatchObject({ status: 0, message: AVISO_SESSAO_EXPIRADA });
    _reiniciarSessao();
    simularRede(async () => resposta({ status: 401 }), async () => json(401, { erro: "Acesso negado" }));
    const e = await obterConfig().catch((x) => x);
    expect(e).toBeInstanceOf(ErroConfig);
    expect(e).toMatchObject({ status: 401, message: AVISO_SESSAO_EXPIRADA });
  });

  it("configurações: erro de rede com sessão válida mantém a mensagem de rede", async () => {
    simularRede(async () => resposta({ status: 200 }));
    expect(await obterConfig().catch((x) => x)).toMatchObject({ status: 0, message: "Não consegui falar com o servidor. Tente de novo." });
  });
});

describe("upload (XMLHttpRequest)", () => {
  class XhrFalso {
    static ultimo: XhrFalso;
    status = 0; responseText = "";
    upload: { onprogress: unknown } = { onprogress: null };
    onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
    constructor() { XhrFalso.ultimo = this; }
    open() {} send() {} abort() {}
  }
  const arquivo = { name: "a.pdf" } as File;
  beforeEach(() => vi.stubGlobal("XMLHttpRequest", XhrFalso));

  it("erro de rede com a sessão vencida: aviso de sessão e recarga", async () => {
    simularRede(async () => redirectOpaco());
    const p = enviarAnexo("a", arquivo, () => {});
    XhrFalso.ultimo.onerror?.();
    expect(await p.catch((x) => x)).toMatchObject({ status: 401, message: AVISO_SESSAO_EXPIRADA });
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("erro de rede com a sessão válida: mensagem de rede, sem recarga", async () => {
    simularRede(async () => resposta({ status: 200 }));
    const p = enviarAnexo("a", arquivo, () => {});
    XhrFalso.ultimo.ontimeout?.();
    expect(await p.catch((x) => x)).toMatchObject({ status: 0, message: "Não consegui falar com o servidor. Tente de novo." });
    expect(reload).not.toHaveBeenCalled();
  });

  it("401 do servidor com a sessão vencida: aviso de sessão", async () => {
    simularRede(async () => resposta({ status: 401 }));
    const p = enviarAnexo("a", arquivo, () => {});
    XhrFalso.ultimo.status = 401; XhrFalso.ultimo.responseText = JSON.stringify({ erro: "Acesso negado" });
    XhrFalso.ultimo.onload?.();
    expect(await p.catch((x) => x)).toMatchObject({ status: 401, message: AVISO_SESSAO_EXPIRADA });
  });

  it("erro 413 do servidor não confere a sessão", async () => {
    const f = simularRede(async () => resposta({ status: 200 }));
    const p = enviarAnexo("a", arquivo, () => {});
    XhrFalso.ultimo.status = 413; XhrFalso.ultimo.responseText = JSON.stringify({ erro: "Arquivo grande demais" });
    XhrFalso.ultimo.onload?.();
    expect(await p.catch((x) => x)).toMatchObject({ status: 413, message: "Arquivo grande demais" });
    expect(chamadasSaude(f)).toHaveLength(0);
  });
});

class FonteFalsa implements FonteEventos {
  static todas: FonteFalsa[] = [];
  readyState = 0; fechada = false;
  onopen: ((ev: Event) => void) | null = null; onerror: ((ev: Event) => void) | null = null;
  constructor(public url: string) { FonteFalsa.todas.push(this); }
  addEventListener() {}
  close() { this.fechada = true; this.readyState = 2; }
  cair() { this.readyState = 2; this.onerror?.(new Event("error")); }
}

describe("SSE com a sessão vencida", () => {
  afterEach(() => { FonteFalsa.todas = []; });

  it("confere a sessão antes de reabrir; vencida: não reabre e avisa que expirou", async () => {
    const conferir = vi.fn(async () => true);
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u), conferir);
    const estados: string[] = [];
    g.abrir("a", () => {}, (s) => estados.push(s));
    FonteFalsa.todas[0].cair();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(conferir).toHaveBeenCalledTimes(1);
    expect(FonteFalsa.todas).toHaveLength(1);
    expect(estados).toEqual(["reconectando", "expirada"]);
  });

  it("sessão válida: reabre depois da espera e zera a contagem ao conectar", async () => {
    const conferir = vi.fn(async () => false);
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u), conferir);
    g.abrir("a", () => {}, () => {});
    FonteFalsa.todas[0].cair();
    await vi.advanceTimersByTimeAsync(3000);
    expect(FonteFalsa.todas).toHaveLength(2);
    FonteFalsa.todas[1].cair();
    await vi.advanceTimersByTimeAsync(6000);
    expect(FonteFalsa.todas).toHaveLength(3);
    expect(conferir).toHaveBeenCalledTimes(2);
  });

  it("vencida na segunda queda: para ali, sem novas reaberturas", async () => {
    const conferir = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u), conferir);
    g.abrir("a", () => {}, () => {});
    FonteFalsa.todas[0].cair();
    await vi.advanceTimersByTimeAsync(3000);
    FonteFalsa.todas[1].cair();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FonteFalsa.todas).toHaveLength(2);
  });

  it("trocar de conversa enquanto confere descarta o resultado", async () => {
    let resolver!: (v: boolean) => void;
    const conferir = vi.fn(() => new Promise<boolean>((r) => { resolver = r; }));
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u), conferir);
    const estados: string[] = [];
    g.abrir("a", () => {}, (s) => estados.push(`a:${s}`));
    FonteFalsa.todas[0].cair();
    g.abrir("b", () => {}, (s) => estados.push(`b:${s}`));
    resolver(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(estados).toEqual(["a:reconectando"]);
    expect(FonteFalsa.todas.map((f) => f.url)).toEqual(["/api/conversas/a/eventos", "/api/conversas/b/eventos"]);
  });

  it("com o conferirSessao real: redirect do Access para a reabertura e recarrega a página uma vez", async () => {
    simularRede(async () => redirectOpaco());
    const g = criarGerenciadorEventos((u) => new FonteFalsa(u));
    g.abrir("a", () => {}, () => {});
    FonteFalsa.todas[0].cair();
    await vi.advanceTimersByTimeAsync(ESPERA_RECARGA_MS + 60_000);
    expect(FonteFalsa.todas).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
