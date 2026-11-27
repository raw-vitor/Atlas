import type { RGB } from "./estados";

// Enxame neural "02·A": casca de Fibonacci, núcleo interno e arestas k-NN fixas.
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const CAM = 4.2;
const BINS_PONTO = 8;
const BINS_ARESTA = 6;

export const lim = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const suave = (e0: number, e1: number, x: number) => { const t = lim((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mixc = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${lim(a).toFixed(3)})`;

export function semeado(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
function vetorUnitario(r: () => number): [number, number, number] {
  const x = gauss(r), y = gauss(r), z = gauss(r), l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

export function esferaFibonacci(n: number, jitter: number, r: () => number) {
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const yy = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), th = i * GOLDEN + (r() - 0.5) * jitter;
    x[i] = Math.cos(th) * rr; y[i] = yy; z[i] = Math.sin(th) * rr;
  }
  return { x, y, z };
}

export function arestasKnn(x: Float32Array, y: Float32Array, z: Float32Array, n: number, k: number) {
  const vistas = new Set<number>(), out: number[] = [];
  const bestD = new Float64Array(k), bestI = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    bestD.fill(Infinity); bestI.fill(-1);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j], dd = dx * dx + dy * dy + dz * dz;
      if (dd >= bestD[k - 1]) continue;
      let p = k - 1;
      while (p > 0 && bestD[p - 1] > dd) { bestD[p] = bestD[p - 1]; bestI[p] = bestI[p - 1]; p--; }
      bestD[p] = dd; bestI[p] = j;
    }
    for (let q = 0; q < k; q++) {
      const j = bestI[q]; if (j < 0) continue;
      const a = Math.min(i, j), b = Math.max(i, j), key = a * n + b;
      if (!vistas.has(key)) { vistas.add(key); out.push(a, b); }
    }
  }
  return Uint16Array.from(out);
}

function matrizRotacao(yaw: number, pitch: number, roll: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const a = [cy, 0, sy], b = [sp * sy, cp, -sp * cy], c = [-cp * sy, sp, cp * cy];
  return [
    cr * a[0] - sr * b[0], cr * a[1] - sr * b[1], cr * a[2] - sr * b[2],
    sr * a[0] + cr * b[0], sr * a[1] + cr * b[1], sr * a[2] + cr * b[2],
    c[0], c[1], c[2],
  ];
}

export type Estilo = "padrao" | "citoesqueleto";

export interface Nivel {
  /** Pontos da casca. */ ns: number;
  /** Pontos do núcleo interno. */ ni: number;
  /** Com arestas k-NN, anel-guia e pontos quentes. */ detalhe: boolean;
  /** "citoesqueleto": k=3 na casca, núcleo uniforme e desenho da 02·base (public/base.html). */ estilo: Estilo;
}

export function nivelDetalhe(tamanho: number, estilo: Estilo = "padrao"): Nivel {
  if (tamanho >= 300) return { ns: 920, ni: 170, detalhe: true, estilo };
  if (tamanho >= 96) return { ns: 560, ni: 110, detalhe: true, estilo };
  if (tamanho >= 40) return { ns: 160, ni: 30, detalhe: false, estilo };
  return { ns: 90, ni: 20, detalhe: false, estilo };
}

export class Geometria {
  readonly n: number;
  readonly ns: number;
  readonly bx: Float32Array; readonly by: Float32Array; readonly bz: Float32Array;
  readonly sz: Float32Array; readonly ph: Float32Array;
  readonly arestas: Uint16Array;
  readonly estilo: Estilo;
  /** Arestas por nó da casca (só citoesqueleto usa; junção = grau >= 3). */
  readonly grau: Uint8Array;
  readonly fasesAresta: Float32Array;
  /** Constelação 02·F: nós (1 a cada 3 pontos da casca), posição final de cada ponto e arestas k-NN entre os nós. */
  readonly nos: Uint16Array;
  readonly ehNo: Uint8Array;
  readonly alvoX: Float32Array; readonly alvoY: Float32Array; readonly alvoZ: Float32Array;
  readonly arestasC: Uint16Array;
  /** Atraso (0 a 1) de cada aresta da constelação: onda que parte de um ponto da esfera. */
  readonly atrasoC: Float32Array;

  constructor(nivel: Nivel, semente = 42) {
    const r = semeado(semente);
    const { ns, ni } = nivel;
    const n = ns + ni;
    this.n = n; this.ns = ns; this.estilo = nivel.estilo;
    const cito = nivel.estilo === "citoesqueleto";
    this.bx = new Float32Array(n); this.by = new Float32Array(n); this.bz = new Float32Array(n);
    this.sz = new Float32Array(n); this.ph = new Float32Array(n);
    const sph = esferaFibonacci(ns, 0.4, r);
    for (let i = 0; i < ns; i++) {
      const j = 0.93 + r() * 0.14;
      this.bx[i] = sph.x[i] * j; this.by[i] = sph.y[i] * j; this.bz[i] = sph.z[i] * j;
      this.sz[i] = cito ? 0.7 + r() * 0.85 : 0.7 + r() * 0.9;
      this.ph[i] = r() * TAU;
    }
    for (let i = ns; i < n; i++) {
      const v = vetorUnitario(r);
      const camada = (i % 3) / 2;
      const rad = cito ? 0.22 + 0.38 * Math.cbrt(r()) : 0.24 + (0.14 + 0.24 * camada) + 0.05 * Math.cbrt(r());
      this.bx[i] = v[0] * rad; this.by[i] = v[1] * rad; this.bz[i] = v[2] * rad;
      this.sz[i] = 0.55 + r() * 0.65;
      this.ph[i] = r() * TAU;
    }
    this.arestas = nivel.detalhe ? arestasKnn(sph.x, sph.y, sph.z, ns, cito ? 3 : 2) : new Uint16Array(0);
    this.grau = new Uint8Array(ns);
    for (let q = 0; q < this.arestas.length; q++) { const v = this.arestas[q]; this.grau[v] = Math.min(255, this.grau[v] + 1); }
    this.fasesAresta = Float32Array.from({ length: this.arestas.length / 2 }, () => r() * TAU);

    // Constelação: gerador próprio, para não mexer na sequência da esfera.
    this.ehNo = new Uint8Array(n);
    this.alvoX = new Float32Array(n); this.alvoY = new Float32Array(n); this.alvoZ = new Float32Array(n);
    if (!nivel.detalhe) { this.nos = new Uint16Array(0); this.arestasC = new Uint16Array(0); this.atrasoC = new Float32Array(0); return; }
    const r2 = semeado(semente + 521);
    const lista: number[] = [];
    for (let i = 0; i < ns; i += 3) lista.push(i);
    this.nos = Uint16Array.from(lista);
    const nn = lista.length;
    const ux = new Float32Array(nn), uy = new Float32Array(nn), uz = new Float32Array(nn);
    lista.forEach((i, q) => {
      const l = Math.hypot(this.bx[i], this.by[i], this.bz[i]) || 1;
      ux[q] = this.bx[i] / l; uy[q] = this.by[i] / l; uz[q] = this.bz[i] / l;
      const rad = 0.86 + r2() * 0.22;
      this.ehNo[i] = 1;
      this.alvoX[i] = ux[q] * rad; this.alvoY[i] = uy[q] * rad; this.alvoZ[i] = uz[q] * rad;
    });
    // Quem não é nó caminha até o nó mais próximo em direção.
    for (let i = 0; i < n; i++) {
      if (this.ehNo[i]) continue;
      const l = Math.hypot(this.bx[i], this.by[i], this.bz[i]) || 1;
      const x = this.bx[i] / l, y = this.by[i] / l, z = this.bz[i] / l;
      let melhor = 0, dm = -2;
      for (let q = 0; q < nn; q++) { const dp = x * ux[q] + y * uy[q] + z * uz[q]; if (dp > dm) { dm = dp; melhor = q; } }
      const o = lista[melhor];
      this.alvoX[i] = this.alvoX[o]; this.alvoY[i] = this.alvoY[o]; this.alvoZ[i] = this.alvoZ[o];
    }
    const ak = arestasKnn(ux, uy, uz, nn, 3);
    this.arestasC = Uint16Array.from(ak, (q) => lista[q]);
    const ox = 0.3, oy = 0.8, oz = 0.52, ol = Math.hypot(ox, oy, oz);
    this.atrasoC = Float32Array.from({ length: ak.length / 2 }, (_v, k) => {
      const a = ak[2 * k], b = ak[2 * k + 1];
      const mx = ux[a] + ux[b], my = uy[a] + uy[b], mz = uz[a] + uz[b], ml = Math.hypot(mx, my, mz) || 1;
      const ang = Math.acos(lim((mx * ox + my * oy + mz * oz) / (ml * ol), -1, 1)) / Math.PI;
      return lim(ang * 0.9 + r2() * 0.1);
    });
  }
}

// O k-NN custa O(n²): as esferas da página compartilham a geometria pelo nível de detalhe.
const cache = new Map<string, Geometria>();
export function geometriaPara(nivel: Nivel): Geometria {
  const chave = `${nivel.ns}:${nivel.ni}:${nivel.detalhe}:${nivel.estilo}`;
  let g = cache.get(chave);
  if (!g) { g = new Geometria(nivel); cache.set(chave, g); }
  return g;
}

/** Estado dinâmico integrado a cada quadro. */
export interface Dinamica {
  yaw: number; flow: number; sig: number; prec: number; wave: number; breath: number; level: number;
}
export const dinamicaInicial = (): Dinamica => ({ yaw: 0.6, flow: 0, sig: 0, prec: 0, wave: 0, breath: 0, level: 0.1 });

export interface QuadroEnxame {
  ctx: CanvasRenderingContext2D;
  tamanho: number;
  /** Lado do canvas, quando maior que `tamanho` (folga para a esfera ampliada). */
  lado?: number;
  /** Escala extra do raio, 1 = normal. */
  amp?: number;
  d: Dinamica;
  conv: number; wave: number; route: number; focus: number; glow: number; scale: number; fixo: number;
  /** 0 = esfera, 1 = constelação 02·F. Só vale com detalhe. */
  constel?: number;
  frente: RGB; tras: RGB; nucleo: RGB; linha: RGB; quente: RGB;
  /** Paleta para fundo escuro: soma a luz dos pontos ("lighter"). */
  aditivo?: boolean;
}

/** Buffers de projeção reutilizados entre quadros. */
export class Projecao {
  x: Float32Array; y: Float32Array; z: Float32Array; s: Float32Array;
  bin: Uint8Array; binAresta: Uint8Array; binArestaC: Uint8Array; progC: Float32Array;
  constructor(n: number, arestas: number, arestasC = 0) {
    this.binArestaC = new Uint8Array(arestasC); this.progC = new Float32Array(arestasC);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n); this.s = new Float32Array(n);
    this.bin = new Uint8Array(n); this.binAresta = new Uint8Array(arestas);
  }
}

export function desenharEnxame(g: Geometria, P: Projecao, f: QuadroEnxame, detalhe: boolean) {
  const { ctx, d, tamanho } = f;
  const lado = f.lado ?? tamanho;
  const cx = lado / 2, cy = lado / 2, R = tamanho * 0.29 * Math.max(0.1, f.amp ?? 1);
  const cito = g.estilo === "citoesqueleto", grau = g.grau;
  const { n, ns, bx, by, bz, sz, ph, arestas, fasesAresta, ehNo, alvoX, alvoY, alvoZ, arestasC, atrasoC } = g;
  const cm = detalhe && g.nos.length ? lim(f.constel ?? 0) : 0;
  const ePos = suave(0, 0.6, cm);
  const Fc = lim(f.focus, 0, 1.3), Rt = lim(f.route, 0, 1.4), G = Math.max(0, f.glow);
  const A = Math.max(0, f.wave), Cv = lim(f.conv, -0.25, 0.25);
  // O tamanho dos pontos acompanha a esfera, com limites para não sumirem nem virarem manchas.
  const reforco = lim(R / 45, 0.45, 1.25);
  const e = A * lerp(d.level, 0.75, f.fixo);
  const sc = f.scale * (1 + d.breath * 0.025);

  const pitch = 0.4 + Math.sin(d.prec) * 0.07;
  const roll = -0.18 + Math.sin(d.prec * 0.63 + 1) * 0.05;
  const M = matrizRotacao(d.yaw, pitch, roll);
  const Mi = matrizRotacao(d.yaw * (0.42 + 0.18 * Fc) + 1.3, pitch, roll);

  const projetar = (m: number[], x: number, y: number, z: number, i: number) => {
    const X = m[0] * x + m[1] * y + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z;
    const s = CAM / (CAM - Z);
    P.x[i] = cx + X * R * s; P.y[i] = cy - Y * R * s; P.z[i] = Z; P.s[i] = s;
  };

  // Brilho do núcleo
  const rg = Math.min(lado / 2, R * (1.55 + e * 0.25 + Fc * 0.12)); // sem corte reto na borda do canvas
  const glowA = cito ? 0.26 : 0.2;
  const forca = 0.55 + G * 0.5 + e * 0.4;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rg);
  grad.addColorStop(0, rgba(f.nucleo, glowA * forca));
  grad.addColorStop(0.42, rgba(f.nucleo, glowA * 0.32 * forca));
  grad.addColorStop(1, rgba(f.nucleo, 0));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, rg, 0, TAU); ctx.fill();

  if (detalhe && !cito && cm < 0.99) {
    // Anel-guia do núcleo
    ctx.strokeStyle = rgba(f.linha, (0.06 + 0.08 * Fc) * (0.6 + 0.4 * G) * (1 - suave(0, 0.5, cm)));
    ctx.lineWidth = 0.75 * reforco;
    ctx.beginPath();
    const segs = 64, rGuia = 0.42 * sc;
    for (let s = 0; s <= segs; s++) {
      const ang = (s / segs) * TAU;
      projetar(Mi, Math.cos(ang) * rGuia, Math.sin(ang) * rGuia * 0.68, Math.sin(ang) * rGuia * 0.35, 0);
      if (s === 0) ctx.moveTo(P.x[0], P.y[0]); else ctx.lineTo(P.x[0], P.y[0]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const casca = i < ns;
    const fatorConv = casca ? 1 + Cv : 1 - Cv * 0.35;
    const k = sc * fatorConv * (1 + e * 0.09 * Math.sin(by[i] * 4.6 + bx[i] * 1.7 - d.wave));
    if (cm <= 0) { projetar(casca ? M : Mi, bx[i] * k, by[i] * k, bz[i] * k, i); continue; }
    // Entre a esfera e a constelação: mistura as posições já rotacionadas, cada ponto no seu referencial.
    const m0 = casca ? M : Mi, x0 = bx[i] * k, y0 = by[i] * k, z0 = bz[i] * k;
    const kc = sc * (1 + e * 0.04 * Math.sin(i * 0.15 + d.wave * 0.8) * cm);
    const x1 = alvoX[i] * kc, y1 = alvoY[i] * kc, z1 = alvoZ[i] * kc;
    const Xa = m0[0] * x0 + m0[1] * y0 + m0[2] * z0, Ya = m0[3] * x0 + m0[4] * y0 + m0[5] * z0, Za = m0[6] * x0 + m0[7] * y0 + m0[8] * z0;
    const Xb = M[0] * x1 + M[1] * y1 + M[2] * z1, Yb = M[3] * x1 + M[4] * y1 + M[5] * z1, Zb = M[6] * x1 + M[7] * y1 + M[8] * z1;
    const Z = lerp(Za, Zb, ePos), s = CAM / (CAM - Z);
    P.x[i] = cx + lerp(Xa, Xb, ePos) * R * s; P.y[i] = cy - lerp(Ya, Yb, ePos) * R * s; P.z[i] = Z; P.s[i] = s;
  }

  const fo = 1 - suave(0, 0.45, cm);
  if (detalhe && fo > 0.01) {
    const ne = arestas.length / 2;
    const tw = d.sig * (1.5 + Rt * 0.8);
    for (let k = 0; k < ne; k++) {
      const a = arestas[2 * k], b = arestas[2 * k + 1];
      const vis = suave(-0.1, 0.6, (P.z[a] + P.z[b]) * 0.5);
      if (vis < 0.02) { P.binAresta[k] = 255; continue; }
      const pulsoRota = 0.5 + 0.5 * Math.sin(tw + fasesAresta[k] - d.flow * 1.2);
      const peso = cito ? (0.3 + 0.7 * pulsoRota * pulsoRota) * (0.7 + 0.3 * Rt) : (0.22 + 0.78 * Math.pow(pulsoRota, 1.4)) * (0.55 + 0.45 * Rt);
      P.binAresta[k] = Math.min(BINS_ARESTA - 1, (vis * peso * BINS_ARESTA) | 0);
    }
    ctx.lineWidth = 0.82 * reforco;
    for (let b = 0; b < BINS_ARESTA; b++) {
      if (cito) ctx.lineWidth = (0.55 + (b / BINS_ARESTA) * 0.65) * reforco;
      ctx.beginPath();
      for (let k = 0; k < ne; k++) {
        if (P.binAresta[k] !== b) continue;
        const i = arestas[2 * k], j = arestas[2 * k + 1];
        ctx.moveTo(P.x[i], P.y[i]); ctx.lineTo(P.x[j], P.y[j]);
      }
      ctx.strokeStyle = rgba(f.linha, ((b + 0.5) / BINS_ARESTA) * (cito ? 0.07 + 0.2 * G : 0.07 + 0.22 * G) * fo);
      ctx.stroke();
    }
  }

  if (cm > 0.15) {
    // Arestas da constelação: cada linha cresce do nó A até o nó B, em onda a partir de um ponto da esfera.
    const nc = arestasC.length / 2;
    const mE = suave(0.15, 0.9, cm), tw = d.sig * 1.4;
    for (let k = 0; k < nc; k++) {
      const a = arestasC[2 * k], b = arestasC[2 * k + 1];
      const at = atrasoC[k] * 0.6;
      const p = suave(at, at + 0.4, mE);
      const vis = suave(-0.15, 0.65, (P.z[a] + P.z[b]) * 0.5);
      if (p < 0.01 || vis < 0.02) { P.binArestaC[k] = 255; continue; }
      P.progC[k] = p;
      const onda = 0.5 + 0.5 * Math.sin(tw + fasesAresta[k % Math.max(1, fasesAresta.length)]);
      P.binArestaC[k] = Math.min(BINS_ARESTA - 1, (vis * (0.28 + 0.72 * onda * onda) * (0.35 + 0.65 * p) * BINS_ARESTA) | 0);
    }
    ctx.lineWidth = 0.82 * reforco;
    for (let b = 0; b < BINS_ARESTA; b++) {
      ctx.beginPath();
      for (let k = 0; k < nc; k++) {
        if (P.binArestaC[k] !== b) continue;
        const i = arestasC[2 * k], j = arestasC[2 * k + 1], p = P.progC[k];
        ctx.moveTo(P.x[i], P.y[i]); ctx.lineTo(P.x[i] + (P.x[j] - P.x[i]) * p, P.y[i] + (P.y[j] - P.y[i]) * p);
      }
      ctx.strokeStyle = rgba(f.linha, ((b + 0.5) / BINS_ARESTA) * (0.07 + 0.22 * G));
      ctx.stroke();
    }
  }

  for (let i = 0; i < n; i++) P.bin[i] = Math.min(BINS_PONTO - 1, Math.max(0, (lim((P.z[i] + 1) * 0.5) * BINS_PONTO) | 0));
  const boost = cito ? 1.25 : 1;
  if (cito && f.aditivo) ctx.globalCompositeOperation = "lighter";
  for (let b = 0; b < BINS_PONTO; b++) {
    const k = (b + 0.5) / BINS_PONTO, dof = 1 + (1 - k) * (cito ? 0.75 : 0.3);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (P.bin[i] !== b) continue;
      const kn = cm <= 0 ? 1 : ehNo[i] ? 1 + 0.3 * suave(0.3, 1, cm) : 1 - suave(0.15, 0.65, cm);
      const rr = sz[i] * P.s[i] * dof * reforco * kn * boost * (cito && i < ns && grau[i] >= 3 ? 1.2 : 1);
      if (rr < 0.04) continue;
      ctx.moveTo(P.x[i] + rr, P.y[i]); ctx.arc(P.x[i], P.y[i], rr, 0, TAU);
    }
    ctx.fillStyle = rgba(mixc(f.tras, f.frente, k), (0.12 + 0.86 * k * k) / dof);
    ctx.fill();
  }

  if (cito) ctx.globalCompositeOperation = "source-over";

  if (cito && detalhe && fo > 0.01) {
    // Anéis nas junções (grau >= 3) voltadas para a câmera
    ctx.lineWidth = 0.7 * reforco;
    for (let i = 0; i < ns; i += 9) {
      if (P.z[i] < 0.15 || grau[i] < 3) continue;
      ctx.strokeStyle = rgba(f.quente, suave(0.15, 0.75, P.z[i]) * 0.32 * fo);
      ctx.beginPath(); ctx.arc(P.x[i], P.y[i], sz[i] * P.s[i] * boost * 1.9 * reforco, 0, TAU); ctx.stroke();
    }
  }

  if (cito && detalhe && fo > 0.01) {
    // Pontos quentes da 02·base: passo 23
    ctx.fillStyle = rgba(f.quente, 0.85 * fo);
    ctx.beginPath();
    for (let i = 0; i < ns; i += 23) {
      if (P.z[i] < 0.2) continue;
      const s = suave(0.55, 1, Math.sin(d.sig * 2.1 + ph[i])) * suave(0.2, 0.6, P.z[i]);
      if (s < 0.02) continue;
      const rr = (1 + s * 1.6) * boost * reforco;
      ctx.moveTo(P.x[i] + rr, P.y[i]); ctx.arc(P.x[i], P.y[i], rr, 0, TAU);
    }
    ctx.fill();
  }

  if (!cito && detalhe && cm < 0.99) {
    // Pontos quentes: sinais que atravessam a face voltada para a câmera
    ctx.fillStyle = rgba(f.quente, (0.78 + 0.15 * lim(Fc)) * (1 - suave(0, 0.4, cm)));
    ctx.beginPath();
    for (let i = 0; i < ns; i += 19) {
      if (P.z[i] < 0.2) continue;
      const s = suave(0.5 - 0.2 * lim(Fc), 1, Math.sin(d.sig * 2.1 + ph[i])) * suave(0.2, 0.6, P.z[i]);
      if (s < 0.02) continue;
      const rr = (0.95 + s * (1.4 + 0.5 * lim(Fc))) * reforco;
      ctx.moveTo(P.x[i] + rr, P.y[i]); ctx.arc(P.x[i], P.y[i], rr, 0, TAU);
    }
    ctx.fill();
  }

  if (cm > 0.3) {
    // Âncora central da constelação
    const ac = suave(0.3, 1, cm), pulso = e + d.breath * 0.5, rHalo = R * (0.14 + 0.03 * pulso);
    const gh = ctx.createRadialGradient(cx, cy, 0, cx, cy, rHalo);
    gh.addColorStop(0, rgba(f.quente, 0.34 * ac)); gh.addColorStop(0.55, rgba(f.nucleo, 0.12 * ac)); gh.addColorStop(1, rgba(f.nucleo, 0));
    ctx.fillStyle = gh;
    ctx.beginPath(); ctx.arc(cx, cy, rHalo, 0, TAU); ctx.fill();
  }
  if (cito && cm <= 0.3) return; // fora da constelação não há ponto central
  const rNucleo = R * (0.032 + 0.012 * lim(Fc) + 0.01 * d.level) * (1 + 0.5 * suave(0.3, 1, cm));
  ctx.fillStyle = rgba(f.quente, 0.55 + 0.35 * lim(Fc));
  ctx.beginPath(); ctx.arc(cx, cy, rNucleo, 0, TAU); ctx.fill();
}
