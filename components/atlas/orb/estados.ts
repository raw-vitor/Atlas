export type OrbEstado = "parado" | "pensando" | "falando" | "erro";
export type RGB = [number, number, number];

export interface ParametrosEstado {
  fluidez: number; // multiplica a velocidade de rotação
  intensidade: number; // multiplica o pulso
  brilho: number; // multiplica o brilho do núcleo
  raio: number; // multiplica o raio base
  frente: RGB;
  tras: RGB;
  nucleo: RGB;
}

// Paleta EQI sobre fundo claro: escuro na frente, claro atrás.
const VERDE = { frente: [0, 64, 49] as RGB, tras: [99, 198, 165] as RGB, nucleo: [0, 158, 118] as RGB };
const VERMELHO = { frente: [92, 31, 20] as RGB, tras: [231, 177, 166] as RGB, nucleo: [181, 80, 60] as RGB };

export const ESTADOS: Record<OrbEstado, ParametrosEstado> = {
  parado: { fluidez: 1, intensidade: 1, brilho: 0.8, raio: 1, ...VERDE },
  pensando: { fluidez: 1.6, intensidade: 1, brilho: 1.1, raio: 1, ...VERDE },
  falando: { fluidez: 1, intensidade: 1, brilho: 1.3, raio: 1, ...VERDE },
  erro: { fluidez: 0.3, intensidade: 0.3, brilho: 0.5, raio: 0.95, ...VERMELHO },
};

/** Nível de "áudio" simulado, 0 a 1. `t` em segundos. Determinístico. */
export function nivel(estado: OrbEstado, t: number): number {
  const a = t * 1.8; // a referência avança 0,03 por quadro a 60 Hz
  const ruido = Math.sin(a * 37) * 0.5 + 0.5;
  let n: number;
  switch (estado) {
    case "parado": n = Math.sin(a * 1.2) * 0.15 + 0.15; break;
    case "pensando": n = 0.35 + Math.sin(a * 4) * 0.2 + ruido * 0.05; break;
    case "falando": n = Math.abs(Math.sin(a * 5) * Math.cos(a * 2.3)) * 0.7 + 0.3 + ruido * 0.1; break;
    case "erro": n = 0.03; break;
  }
  return Math.min(1, Math.max(0, n));
}

const mix = (a: number, b: number, k: number) => (k >= 1 ? b : a + (b - a) * k);
const mixRgb = (a: RGB, b: RGB, k: number): RGB => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];

export function interpolar(a: ParametrosEstado, b: ParametrosEstado, k: number): ParametrosEstado {
  return {
    fluidez: mix(a.fluidez, b.fluidez, k),
    intensidade: mix(a.intensidade, b.intensidade, k),
    brilho: mix(a.brilho, b.brilho, k),
    raio: mix(a.raio, b.raio, k),
    frente: mixRgb(a.frente, b.frente, k),
    tras: mixRgb(a.tras, b.tras, k),
    nucleo: mixRgb(a.nucleo, b.nucleo, k),
  };
}
