import { afterEach, describe, expect, it, vi } from "vitest";
import { ESTADOS, ESTADOS_ESCURO, interpolar, nivel, type OrbEstado } from "@/components/atlas/orb/estados";
import { Geometria, geometriaPara, nivelDetalhe } from "@/components/atlas/orb/enxame";

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

describe("esfera: parado", () => {
  it("usa os valores ajustados", () => {
    const p = ESTADOS.parado;
    expect(p.spin).toBe(0.2);
    expect(p.conv).toBe(0);
    expect(p.route).toBe(0);
    expect(p.focus).toBe(0.08);
    expect(p.wave).toBeCloseTo(0.08 * 1.8, 6);
  });
});

describe("esfera: geometria", () => {
  it("casca fica entre 0,93 e 1,07 do raio e o núcleo dentro dela", () => {
    const g = new Geometria(nivelDetalhe(140));
    for (let i = 0; i < g.n; i++) {
      const r = Math.hypot(g.bx[i], g.by[i], g.bz[i]);
      if (i < g.ns) { expect(r).toBeGreaterThan(0.92); expect(r).toBeLessThan(1.08); }
      else expect(r).toBeLessThan(0.9);
    }
  });
  it("arestas só existem com detalhe e não repetem pares", () => {
    expect(new Geometria(nivelDetalhe(24)).arestas.length).toBe(0);
    const g = new Geometria(nivelDetalhe(140));
    expect(g.arestas.length).toBeGreaterThan(0);
    const pares = new Set<number>();
    for (let k = 0; k < g.arestas.length; k += 2) pares.add(g.arestas[k] * g.n + g.arestas[k + 1]);
    expect(pares.size).toBe(g.arestas.length / 2);
  });
  it("reaproveita a geometria entre esferas do mesmo nível", () => {
    expect(geometriaPara(nivelDetalhe(140))).toBe(geometriaPara(nivelDetalhe(200)));
  });
});

describe("esfera: constelação 02·F", () => {
  const g = new Geometria(nivelDetalhe(140));
  it("só existe com detalhe", () => {
    const pequeno = new Geometria(nivelDetalhe(24));
    expect(pequeno.nos.length).toBe(0);
    expect(pequeno.arestasC.length).toBe(0);
    expect(g.nos.length).toBeGreaterThan(100);
  });
  it("arestas da constelação ligam só nós, sem repetir par nem ligar nó a si mesmo", () => {
    const pares = new Set<number>();
    for (let k = 0; k < g.arestasC.length; k += 2) {
      const a = g.arestasC[k], b = g.arestasC[k + 1];
      expect(g.ehNo[a]).toBe(1); expect(g.ehNo[b]).toBe(1); expect(a).not.toBe(b);
      pares.add(Math.min(a, b) * g.n + Math.max(a, b));
    }
    expect(pares.size).toBe(g.arestasC.length / 2);
    expect(g.atrasoC.length).toBe(g.arestasC.length / 2);
    for (const v of g.atrasoC) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it("todo ponto tem destino sobre a casca da constelação (raio 0,86 a 1,08)", () => {
    for (let i = 0; i < g.n; i++) {
      const r = Math.hypot(g.alvoX[i], g.alvoY[i], g.alvoZ[i]);
      expect(r).toBeGreaterThan(0.85); expect(r).toBeLessThan(1.09);
    }
  });
  it("a geometria da esfera não mudou", () => {
    expect(new Geometria(nivelDetalhe(140)).bx).toEqual(g.bx);
    expect(g.arestas.length).toBeGreaterThan(0);
  });
});

describe("esfera: desenho da transição", () => {
  it("desenha sem erro e sem coordenadas inválidas em todo o intervalo da constelação", async () => {
    const { desenharEnxame, dinamicaInicial, Projecao } = await import("@/components/atlas/orb/enxame");
    const g = geometriaPara(nivelDetalhe(140));
    const P = new Projecao(g.n, g.arestas.length / 2, g.arestasC.length / 2);
    let ruim = 0;
    const checa = (...v: number[]) => { if (v.some((x) => !Number.isFinite(x))) ruim++; };
    const grad = { addColorStop() {} };
    const ctx = { moveTo: checa, lineTo: checa, arc: checa, beginPath() {}, stroke() {}, fill() {}, closePath() {},
      createRadialGradient: () => grad } as unknown as CanvasRenderingContext2D;
    const cor: [number, number, number] = [0, 100, 80];
    for (const constel of [0, 0.05, 0.2, 0.5, 0.8, 1])
      desenharEnxame(g, P, { ctx, tamanho: 140, d: { ...dinamicaInicial(), sig: 3, wave: 2 }, conv: 0, wave: 0.3, route: 0.9, focus: 0.9, glow: 0.9,
        scale: 1, fixo: 0, constel, frente: cor, tras: cor, nucleo: cor, linha: cor, quente: cor }, true);
    expect(ruim).toBe(0);
  });
});

describe("esfera: ampliação de 60%", () => {
  async function criar(estatico = false) {
    const { MotorEsfera, AMPLIACAO } = await import("@/components/atlas/orb/motor");
    const grad = { addColorStop() {} };
    const ctx = { moveTo() {}, lineTo() {}, arc() {}, beginPath() {}, stroke() {}, fill() {}, closePath() {}, setTransform() {}, clearRect() {},
      createRadialGradient: () => grad } as unknown as CanvasRenderingContext2D;
    const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    return { m: new MotorEsfera(canvas, { tamanho: 140, estado: "parado", folga: 1.6, estatico }), canvas, AMPLIACAO };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("reserva folga no canvas", async () => {
    const { canvas } = await criar();
    expect(canvas.width).toBe(224);
  });
  it("chega a 1,6 sem passar e volta a 1 sem quique", async () => {
    const { m, AMPLIACAO } = await criar();
    m.definirAmpliacao(true);
    let max = 0;
    for (let i = 0; i < 60 * 4; i++) { m.quadro(1 / 60); max = Math.max(max, m.amp); }
    expect(m.amp).toBeCloseTo(AMPLIACAO, 2);
    expect(max).toBeLessThanOrEqual(AMPLIACAO + 0.005);
    m.definirAmpliacao(false);
    let min = 2;
    for (let i = 0; i < 60 * 4; i++) { m.quadro(1 / 60); min = Math.min(min, m.amp); }
    expect(m.amp).toBe(1);
    expect(min).toBeGreaterThanOrEqual(1);
  });
  it("aoAssentar só dispara depois que a esfera volta ao tamanho", async () => {
    const { m } = await criar();
    const aoAssentar = vi.fn();
    m.aoAssentar = aoAssentar;
    m.definirAmpliacao(true);
    for (let i = 0; i < 60 * 4; i++) m.quadro(1 / 60);
    m.definirAmpliacao(false);
    let ampNaChamada = 0;
    aoAssentar.mockImplementation(() => { ampNaChamada = m.amp; });
    for (let i = 0; i < 60 * 4; i++) m.quadro(1 / 60);
    expect(aoAssentar).toHaveBeenCalledTimes(1);
    expect(ampNaChamada).toBe(1);
  });
  it("não depende da taxa de quadros", async () => {
    const a = await criar(), b = await criar();
    a.m.definirAmpliacao(true); b.m.definirAmpliacao(true);
    for (let i = 0; i < 60; i++) a.m.quadro(1 / 60);
    for (let i = 0; i < 120; i++) b.m.quadro(1 / 120);
    expect(a.m.amp).toBeCloseTo(b.m.amp, 2);
  });
  it("ampliada em \"pensando\", a esfera fica 60% maior que em repouso (compensa a contração do estado)", async () => {
    const { MotorEsfera } = await import("@/components/atlas/orb/motor");
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    const raio = (estado: "parado" | "pensando", ampliar: boolean) => {
      const ds: number[] = [];
      const grad = { addColorStop() {} };
      const ctx = { moveTo() {}, lineTo() {}, beginPath() {}, stroke() {}, fill() {}, closePath() {}, setTransform() {}, clearRect() {},
        arc(x: number, y: number) { ds.push(Math.hypot(x - 112, y - 112)); }, createRadialGradient: () => grad } as unknown as CanvasRenderingContext2D;
      const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
      const m = new MotorEsfera(canvas, { tamanho: 140, estado, folga: 1.6 });
      m.definirAmpliacao(ampliar);
      for (let i = 0; i < 60 * 5; i++) m.quadro(1 / 60);
      ds.length = 0; m.quadro(1 / 60);
      ds.sort((a, b) => a - b);
      return ds[Math.floor(ds.length * 0.98)];
    };
    expect(raio("pensando", true) / raio("parado", false)).toBeGreaterThan(1.55);
    expect(raio("pensando", true) / raio("parado", false)).toBeLessThan(1.65);
  });
  it("modo estático aplica na hora", async () => {
    const { m, AMPLIACAO } = await criar(true);
    m.definirAmpliacao(true);
    expect(m.amp).toBe(AMPLIACAO);
  });
});

describe("esfera: estilo citoesqueleto", () => {
  const padrao = new Geometria(nivelDetalhe(140));
  const g = new Geometria(nivelDetalhe(140, "citoesqueleto"));
  it("usa k=3: pares únicos e mais arestas que o padrão", () => {
    const vistos = new Set<number>();
    for (let k = 0; k < g.arestas.length; k += 2) {
      const a = g.arestas[k], b = g.arestas[k + 1];
      expect(a).toBeLessThan(b);
      vistos.add(a * g.ns + b);
    }
    expect(vistos.size).toBe(g.arestas.length / 2);
    expect(g.arestas.length).toBeGreaterThan(padrao.arestas.length);
  });
  it("grau bate com as arestas", () => {
    const cont = new Uint8Array(g.ns);
    for (const v of g.arestas) cont[v]++;
    expect(g.grau).toEqual(cont);
    expect(padrao.grau.some((v) => v >= 3)).toBe(true);
  });
  it("núcleo uniforme fica dentro de [0,22, 0,6]", () => {
    for (let i = g.ns; i < g.n; i++) {
      const r = Math.hypot(g.bx[i], g.by[i], g.bz[i]);
      expect(r).toBeGreaterThanOrEqual(0.22 - 1e-5);
      expect(r).toBeLessThanOrEqual(0.6 + 1e-5);
    }
  });
  it("a constelação continua sendo gerada", () => {
    expect(g.nos.length).toBeGreaterThan(0);
    expect(g.arestasC.length).toBeGreaterThan(0);
  });
  it("o cache separa os estilos", () => {
    expect(geometriaPara(nivelDetalhe(140, "citoesqueleto"))).toBe(geometriaPara(nivelDetalhe(200, "citoesqueleto")));
    expect(geometriaPara(nivelDetalhe(140, "citoesqueleto"))).not.toBe(geometriaPara(nivelDetalhe(140)));
  });
  it("ESTADOS_ESCURO tem a mesma dinâmica de ESTADOS", () => {
    const cores = ["frente", "tras", "nucleo", "linha", "quente"];
    for (const e of Object.keys(ESTADOS) as OrbEstado[]) {
      const sem = (p: object) => Object.fromEntries(Object.entries(p).filter(([k]) => !cores.includes(k)));
      expect(sem(ESTADOS_ESCURO[e])).toEqual(sem(ESTADOS[e]));
      expect(ESTADOS_ESCURO[e].frente).not.toEqual(ESTADOS[e].frente);
    }
  });
});
