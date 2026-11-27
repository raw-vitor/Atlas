import { afterEach, describe, expect, it, vi } from "vitest";
import { comAmbiente, env } from "@/lib/cf";

vi.mock("@/lib/tarefas/turno", () => ({ executarTurno: vi.fn(async () => undefined) }));
vi.mock("@/lib/tarefas/deck", () => ({ executarDeck: vi.fn(async () => undefined) }));
vi.mock("@/lib/tarefas/purga", () => ({ executarPurga: vi.fn(async () => undefined) }));

import { executarDeck } from "@/lib/tarefas/deck";
import { despachar, esperaReentrega, processarLote } from "@/lib/tarefas";
import { executarPurga } from "@/lib/tarefas/purga";
import { executarTurno } from "@/lib/tarefas/turno";

const envFalso = { ENVIRONMENT: "test" } as unknown as CloudflareEnv;
const ctxFalso = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const c = { env: envFalso, ctx: ctxFalso, tentativa: 1 };

function mensagem(body: unknown, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}
const lote = (...messages: ReturnType<typeof mensagem>[]) => ({ queue: "atlas-tarefas", messages }) as unknown as MessageBatch<unknown>;

afterEach(() => vi.clearAllMocks());

describe("despacho das tarefas da fila", () => {
  it("cada tipo chama a sua função", async () => {
    await despachar({ tipo: "turno", conversaId: "c", usuarioId: "u", tarefaId: "t" }, c);
    await despachar({ tipo: "deck", conversaId: "c", usuarioId: "u", tarefaId: "t" }, c);
    await despachar({ tipo: "purga", conversaId: "c", usuarioId: "u" }, c);
    expect(executarTurno).toHaveBeenCalledTimes(1);
    expect(executarDeck).toHaveBeenCalledTimes(1);
    expect(executarPurga).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tipo desconhecido", { tipo: "leitura", conversaId: "c", usuarioId: "u", tarefaId: "t" }],
    ["sem conversa", { tipo: "purga", usuarioId: "u" }],
    ["sem usuário", { tipo: "purga", conversaId: "c" }],
    ["turno sem tarefa", { tipo: "turno", conversaId: "c", usuarioId: "u" }],
    ["corpo nulo", null],
    ["corpo texto", "turno"],
  ])("recusa mensagem inválida: %s", async (_nome, corpo) => {
    await expect(despachar(corpo, c)).rejects.toThrow("inválida");
  });

  it("sucesso dá ack; falha pede reentrega com espera crescente e não dá ack", async () => {
    vi.mocked(executarPurga).mockRejectedValueOnce(new Error("R2 indisponível"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ok = mensagem({ tipo: "turno", conversaId: "c1", usuarioId: "u", tarefaId: "t" });
    const falha = mensagem({ tipo: "purga", conversaId: "c2", usuarioId: "u" }, 3);
    await processarLote(lote(ok, falha), envFalso, ctxFalso);
    expect(ok.ack).toHaveBeenCalledTimes(1);
    expect(ok.retry).not.toHaveBeenCalled();
    expect(falha.ack).not.toHaveBeenCalled();
    expect(falha.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
  });

  it("mensagem inválida vai para reentrega (e depois para a fila de mortas), nunca é descartada com ack", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = mensagem({ tipo: "xyz" });
    await processarLote(lote(m), envFalso, ctxFalso);
    expect(m.ack).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledTimes(1);
  });

  it("o log de falha leva tipo, conversa, tentativa e classe do erro, sem a mensagem do erro nem o corpo", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(executarTurno).mockRejectedValueOnce(new Error("CPF 123.456.789-09 do cliente Fulano"));
    await processarLote(lote(mensagem({ tipo: "turno", conversaId: "c9", usuarioId: "u", tarefaId: "t" }, 2)), envFalso, ctxFalso);
    const texto = JSON.stringify(log.mock.calls);
    expect(texto).toContain("c9");
    expect(texto).toContain("Error");
    expect(texto).not.toMatch(/CPF|Fulano|123\.456/);
  });

  it("a função da tarefa enxerga o env pelo lib/cf durante toda a execução, inclusive depois de await", async () => {
    let visto: CloudflareEnv | undefined;
    vi.mocked(executarTurno).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 5));
      visto = env();
    });
    await processarLote(lote(mensagem({ tipo: "turno", conversaId: "c", usuarioId: "u", tarefaId: "t" })), envFalso, ctxFalso);
    expect(visto).toBe(envFalso);
  });

  it("espera de reentrega: 10 s, 20 s, 40 s... limitada a 5 min", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(esperaReentrega)).toEqual([10, 20, 40, 80, 160, 300, 300]);
    expect(esperaReentrega(0)).toBe(10);
  });
});

describe("lib/cf", () => {
  it("env(injetado) devolve o argumento; comAmbiente isola execuções concorrentes", async () => {
    const outro = { ENVIRONMENT: "outro" } as unknown as CloudflareEnv;
    expect(env(outro)).toBe(outro);
    const [a, b] = await Promise.all([
      comAmbiente(envFalso, undefined, async () => { await new Promise((r) => setTimeout(r, 10)); return env(); }),
      comAmbiente(outro, undefined, async () => env()),
    ]);
    expect(a).toBe(envFalso);
    expect(b).toBe(outro);
  });

  it("fora de qualquer contexto, falha com a mensagem do OpenNext em vez de devolver env vazio", () => {
    expect(() => env()).toThrow(/initOpenNextCloudflareForDev|getCloudflareContext/);
  });
});
