import { describe, expect, it } from "vitest";
import { ESTADOS, interpolar, nivel, type OrbEstado } from "@/components/atlas/orb/estados";
import { Particulas } from "@/components/atlas/orb/motor";

describe("esfera: estados", () => {
  it("nivel fica em [0, 1]", () => {
    for (const e of Object.keys(ESTADOS) as OrbEstado[])
      for (let t = 0; t < 60; t += 0.037) {
        const n = nivel(e, t);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
  });
  it("interpolar devolve os extremos", () => {
    expect(interpolar(ESTADOS.parado, ESTADOS.erro, 0)).toEqual(ESTADOS.parado);
    expect(interpolar(ESTADOS.parado, ESTADOS.erro, 1)).toEqual(ESTADOS.erro);
  });
});

describe("esfera: partículas", () => {
  it("distribui uniformemente, em camadas de 0,85 a 1,15", () => {
    const p = new Particulas(650, 7);
    let soma = 0;
    for (let i = 0; i < p.n; i++) {
      expect(p.camada[i]).toBeGreaterThanOrEqual(0.85);
      expect(p.camada[i]).toBeLessThanOrEqual(1.15);
      soma += Math.cos(p.phi[i]);
    }
    expect(Math.abs(soma / p.n)).toBeLessThan(0.08);
  });
  it("não depende da taxa de quadros", () => {
    const rodar = (fps: number) => {
      const p = new Particulas(100, 3);
      p.passo(0, 1, 120, 0.3, 1, true);
      for (let q = 0; q < fps; q++) p.passo(1 / fps, 1 + (q + 1) / fps, 120, 0.3, 1);
      return p;
    };
    const a = rodar(60), b = rodar(120);
    for (let i = 0; i < a.n; i++) {
      expect(Math.abs(a.x[i] - b.x[i])).toBeLessThan(6);
      expect(Math.abs(a.y[i] - b.y[i])).toBeLessThan(6);
    }
  });
});
