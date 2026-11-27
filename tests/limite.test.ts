/** Semáforo por isolate: ordem de chegada, posição publicada, liberação idempotente. */
import { describe, expect, it } from "vitest";
import { Semaforo } from "../lib/tarefas/execucao/limite";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Semaforo", () => {
  it("dentro do limite entra na hora, sem publicar posição", async () => {
    const s = new Semaforo(2, 5);
    const posicoes: number[] = [];
    const a = await s.adquirir((n) => posicoes.push(n));
    const b = await s.adquirir((n) => posicoes.push(n));
    expect(posicoes).toEqual([]);
    expect(s.emUso).toBe(2);
    a(); b();
    expect(s.emUso).toBe(0);
  });

  it("acima do limite espera na ordem de chegada e a posição anda", async () => {
    const s = new Semaforo(1, 5);
    const ordem: string[] = [];
    const pos: Record<string, number[]> = { b: [], c: [] };
    const liberarA = await s.adquirir();
    const b = s.adquirir((n) => pos.b.push(n)).then((l) => { ordem.push("b"); return l; });
    await dormir(10);
    const c = s.adquirir((n) => pos.c.push(n)).then((l) => { ordem.push("c"); return l; });
    await dormir(20);
    expect(s.esperando).toBe(2);
    expect(ordem).toEqual([]);
    liberarA();
    const liberarB = await b;
    expect(ordem).toEqual(["b"]);
    await dormir(20);
    expect(ordem).toEqual(["b"]); // c ainda espera a vaga de b
    liberarB();
    (await c)();
    expect(ordem).toEqual(["b", "c"]);
    expect(pos.b).toEqual([1]);
    expect(pos.c).toEqual([2, 1]);
    expect(s.emUso).toBe(0);
    expect(s.esperando).toBe(0);
  });

  it("liberar duas vezes não abre uma vaga que não existe", async () => {
    const s = new Semaforo(1, 5);
    const l = await s.adquirir();
    l(); l();
    const m = await s.adquirir();
    let entrou = false;
    void s.adquirir().then(() => { entrou = true; });
    await dormir(30);
    expect(entrou).toBe(false);
    m();
  });
});
