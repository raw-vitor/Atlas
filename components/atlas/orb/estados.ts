export type OrbEstado = "parado" | "pensando" | "falando" | "erro";
export type RGB = [number, number, number];

export interface ParametrosEstado {
  spin: number; // rotação (rad/s)
  conv: number; // convergência (-) / expansão (+) da casca
  wave: number; // amplitude da onda superficial, já multiplicada pela intensidade global
  route: number; // rotas de atenção
  focus: number; // coerência do núcleo
  glow: number; // brilho, já multiplicado pela intensidade global
  flow: number; // velocidade do fluxo nas rotas
  sig: number; // velocidade dos sinais
  breath: number; // frequência da respiração (Hz)
  scale: number;
  fixo: number; // 1 usa energia fixa (0,75), 0 segue o nível simulado
  frente: RGB;
  tras: RGB;
  nucleo: RGB;
  linha: RGB;
  quente: RGB;
}

// Paleta EQI sobre fundo claro: escuro na frente, claro atrás.
const VERDE = { frente: [0, 64, 49] as RGB, tras: [99, 198, 165] as RGB, nucleo: [0, 158, 118] as RGB, linha: [0, 64, 49] as RGB, quente: [0, 158, 118] as RGB };
const VERMELHO = { frente: [92, 31, 20] as RGB, tras: [231, 177, 166] as RGB, nucleo: [181, 80, 60] as RGB, linha: [92, 31, 20] as RGB, quente: [181, 80, 60] as RGB };

// Paleta para fundo escuro (citoesqueleto): claro na frente, escuro atrás.
const VERDE_ESCURO = { frente: [184, 255, 231] as RGB, tras: [0, 92, 70] as RGB, nucleo: [0, 185, 139] as RGB, linha: [99, 198, 165] as RGB, quente: [214, 255, 241] as RGB };
const VERMELHO_ESCURO = { frente: [255, 214, 205] as RGB, tras: [110, 30, 18] as RGB, nucleo: [210, 90, 66] as RGB, linha: [220, 140, 120] as RGB, quente: [255, 230, 224] as RGB };

/** Esfera parada: valores definidos no ajuste manual (rotação 0,20, onda 0,08, rotas 0, coerência 0,08, intensidade 1,80x). */
const PARADO = { spin: 0.2, conv: 0, wave: 0.08, route: 0, focus: 0.08, intensidade: 1.8 };
const parado: ParametrosEstado = {
  spin: PARADO.spin,
  conv: PARADO.conv,
  wave: PARADO.wave * PARADO.intensidade,
  route: PARADO.route,
  focus: PARADO.focus,
  glow: (0.55 + Math.abs(PARADO.wave) * 0.4) * (0.7 + 0.3 * PARADO.intensidade),
  flow: 0.35 + Math.abs(PARADO.spin) * 0.75,
  sig: 0.35 + PARADO.route * 1.1,
  breath: 0.11,
  scale: 1 + PARADO.conv * 0.25,
  fixo: 1,
  ...VERDE,
};

export const ESTADOS: Record<OrbEstado, ParametrosEstado> = {
  parado,
  pensando: { spin: 0.66, conv: -0.07, wave: 0.26, route: 0.95, focus: 0.92, glow: 0.92, flow: 1.15, sig: 1.55, breath: 0.13, scale: 0.965, fixo: 0, ...VERDE },
  falando: { spin: 0.42, conv: 0.06, wave: 0.88, route: 0.75, focus: 0.62, glow: 1, flow: 0.76, sig: 1.05, breath: 0.11, scale: 1.045, fixo: 0, ...VERDE },
  erro: { spin: 0.08, conv: 0, wave: 0, route: 0, focus: 0, glow: 0.3, flow: 0.1, sig: 0.1, breath: 0.05, scale: 0.95, fixo: 0, ...VERMELHO },
};

/** Mesma dinâmica de ESTADOS, com as cores para fundo escuro. */
export const ESTADOS_ESCURO: Record<OrbEstado, ParametrosEstado> = {
  parado: { ...ESTADOS.parado, ...VERDE_ESCURO },
  pensando: { ...ESTADOS.pensando, ...VERDE_ESCURO },
  falando: { ...ESTADOS.falando, ...VERDE_ESCURO },
  erro: { ...ESTADOS.erro, ...VERMELHO_ESCURO },
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
    spin: mix(a.spin, b.spin, k),
    conv: mix(a.conv, b.conv, k),
    wave: mix(a.wave, b.wave, k),
    route: mix(a.route, b.route, k),
    focus: mix(a.focus, b.focus, k),
    glow: mix(a.glow, b.glow, k),
    flow: mix(a.flow, b.flow, k),
    sig: mix(a.sig, b.sig, k),
    breath: mix(a.breath, b.breath, k),
    scale: mix(a.scale, b.scale, k),
    fixo: mix(a.fixo, b.fixo, k),
    frente: mixRgb(a.frente, b.frente, k),
    tras: mixRgb(a.tras, b.tras, k),
    nucleo: mixRgb(a.nucleo, b.nucleo, k),
    linha: mixRgb(a.linha, b.linha, k),
    quente: mixRgb(a.quente, b.quente, k),
  };
}
