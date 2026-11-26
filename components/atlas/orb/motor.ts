import { ESTADOS, interpolar, nivel, type OrbEstado, type ParametrosEstado, type RGB } from "./estados";

// Espaço lógico de desenho: 480 x 480, como na referência. O canvas é escalado para o tamanho real.
const LOGICO = 480;
const RAIO_BASE = 120;
const FOV = 320;
const CAMERA = 380;
const FACILIDADE = -Math.log(1 - 0.06) * 60; // 0,06 por quadro a 60 Hz, em 1/s
const TEMPO = 0.9; // a referência avança 0,015 por quadro a 60 Hz
const TRANSICAO = 0.2; // constante de tempo (s) da troca de estado, ~600 ms para assentar

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantidadeParticulas(tamanho: number): number {
  if (tamanho >= 300) return 650;
  if (tamanho >= 96) return 380;
  if (tamanho >= 40) return 150;
  return 60;
}

export class Particulas {
  readonly n: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  theta: Float32Array; phi: Float32Array; camada: Float32Array;
  fase: Float32Array; vel: Float32Array; tam: Float32Array; alfa: Float32Array;
  px: Float32Array; py: Float32Array; esc: Float32Array;

  constructor(n: number, semente = 1) {
    this.n = n;
    const f = () => new Float32Array(n);
    this.x = f(); this.y = f(); this.z = f();
    this.theta = f(); this.phi = f(); this.camada = f(); this.fase = f();
    this.vel = f(); this.tam = f(); this.alfa = f();
    this.px = f(); this.py = f(); this.esc = f();
    const r = mulberry32(semente);
    for (let i = 0; i < n; i++) {
      this.theta[i] = r() * Math.PI * 2;
      this.phi[i] = Math.acos(r() * 2 - 1);
      this.camada[i] = 0.85 + r() * 0.3;
      this.fase[i] = r() * Math.PI * 2;
      this.vel[i] = 0.005 + r() * 0.008;
      this.tam[i] = 1.2 + r() * 1.8;
      this.alfa[i] = 0.3 + r() * 0.7;
    }
  }

  /** Avança a física `dt` segundos. `t` é o tempo da animação em segundos. Com `snap`, vai direto ao alvo. */
  passo(dt: number, t: number, raio: number, pulso: number, fluidez: number, snap = false) {
    const q = dt * 60; // equivalente em quadros de 60 Hz
    const k = snap ? 1 : 1 - Math.exp(-FACILIDADE * dt);
    const tt = t * TEMPO;
    for (let i = 0; i < this.n; i++) {
      this.theta[i] += this.vel[i] * fluidez * 0.8 * q;
      this.phi[i] += Math.sin(tt * 0.5 + this.fase[i]) * 0.002 * fluidez * q;

      const onda = Math.sin(tt * 2 + this.fase[i] * 3 + this.theta[i] * 2) * (15 * pulso);
      const r = raio * this.camada[i] + onda;
      const sp = Math.sin(this.phi[i]);
      this.x[i] += (r * sp * Math.cos(this.theta[i]) - this.x[i]) * k;
      this.y[i] += (r * sp * Math.sin(this.theta[i]) - this.y[i]) * k;
      this.z[i] += (r * Math.cos(this.phi[i]) - this.z[i]) * k;
    }
  }

  /** Projeta em perspectiva. Os valores de turbulência não acumulam: são somados só na projeção. */
  projetar(t: number, pulso: number) {
    const tt = t * TEMPO;
    for (let i = 0; i < this.n; i++) {
      let x = this.x[i], y = this.y[i];
      if (pulso > 0.1) {
        x += Math.sin(tt * 8 + this.fase[i]) * pulso * 2.5;
        y += Math.cos(tt * 8 + this.fase[i]) * pulso * 2.5;
      }
      const s = FOV / (this.z[i] + CAMERA);
      this.esc[i] = s;
      this.px[i] = LOGICO / 2 + x * s;
      this.py[i] = LOGICO / 2 + y * s;
    }
  }
}

export interface OpcoesMotor {
  tamanho: number;
  estado: OrbEstado;
  estatico?: boolean;
  semente?: number;
}

const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lim = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export class MotorEsfera {
  visivel = true;
  private ctx: CanvasRenderingContext2D;
  private p: Particulas;
  private ordem: Uint16Array;
  private t = 1;
  private estado: OrbEstado;
  private params: ParametrosEstado;
  private nivelSuave: number;
  private estatico: boolean;
  private tamanho: number;
  private dpr = 1;
  private reforco: number; // engorda partículas em tamanhos pequenos
  private filamentos: boolean;
  private distFilamento: number;

  constructor(private canvas: HTMLCanvasElement, op: OpcoesMotor) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d indisponível");
    this.ctx = ctx;
    this.tamanho = op.tamanho;
    this.estado = op.estado;
    this.estatico = !!op.estatico;
    this.params = ESTADOS[op.estado];
    this.nivelSuave = nivel(op.estado, this.t);
    const n = quantidadeParticulas(op.tamanho);
    this.p = new Particulas(n, op.semente ?? 1);
    this.ordem = new Uint16Array(n).map((_, i) => i);
    this.reforco = Math.max(1, 0.4 / (op.tamanho / LOGICO));
    this.filamentos = op.tamanho >= 96;
    this.distFilamento = 38 * Math.sqrt(650 / n);
    this.redimensionar();
    this.fisica(0, true);
    this.desenhar();
  }

  definirEstado(e: OrbEstado) {
    this.estado = e;
    if (this.estatico) {
      this.params = ESTADOS[e];
      this.nivelSuave = nivel(e, this.t);
      this.fisica(0, true);
      this.desenhar();
    }
  }

  redimensionar() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(1, Math.round(this.tamanho * this.dpr));
    this.canvas.width = px;
    this.canvas.height = px;
    if (this.estatico) this.desenhar();
  }

  quadro(dt: number) {
    this.t += dt;
    const alvo = ESTADOS[this.estado];
    this.params = interpolar(this.params, alvo, 1 - Math.exp(-dt / TRANSICAO));
    this.nivelSuave += (nivel(this.estado, this.t) - this.nivelSuave) * (1 - Math.exp(-dt * 8));
    this.fisica(dt, false);
    this.desenhar();
  }

  /** Posições, para testes. */
  get particulas() { return this.p; }

  private pulso() { return this.nivelSuave * this.params.intensidade; }

  private fisica(dt: number, snap: boolean) {
    const pulso = this.pulso();
    const raio = RAIO_BASE * this.params.raio * (1 + pulso * 0.12);
    this.p.passo(dt, this.t, raio, pulso, this.params.fluidez, snap);
    this.p.projetar(this.t, pulso);
  }

  private desenhar() {
    const { ctx, p, params } = this;
    const pulso = this.pulso();
    const raio = RAIO_BASE * params.raio * (1 + pulso * 0.12);
    const s = (this.tamanho * this.dpr) / LOGICO;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, LOGICO, LOGICO);

    // Brilho do núcleo
    const c = LOGICO / 2;
    const gr = raio * 1.4 + pulso * 25;
    const g = ctx.createRadialGradient(c, c, 5, c, c, gr);
    g.addColorStop(0, rgba(params.nucleo, lim(0.28 * params.brilho, 0, 0.5)));
    g.addColorStop(0.4, rgba(params.nucleo, lim(0.1 * params.brilho, 0, 0.3)));
    g.addColorStop(0.8, rgba(params.nucleo, lim(0.03 * params.brilho, 0, 0.1)));
    g.addColorStop(1, rgba(params.nucleo, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, gr, 0, Math.PI * 2);
    ctx.fill();

    // Ordena de trás para frente (z maior = mais longe da câmera)
    const o = this.ordem;
    o.sort((a, b) => p.z[b] - p.z[a]);

    // "perto" vai de 0 (fundo) a 1 (frente)
    const perto = (i: number) => lim((RAIO_BASE - p.z[i]) / (2 * RAIO_BASE) + 0.1);

    if (this.filamentos) {
      const max = this.distFilamento * (1 + pulso * 0.3);
      ctx.lineCap = "round";
      for (let a = 0; a < o.length; a += 2) {
        const i = o[a];
        if (p.z[i] > 40) continue;
        for (let b = a + 1; b < o.length; b += 3) {
          const j = o[b];
          if (p.z[j] > 40) continue;
          const dx = p.px[i] - p.px[j], dy = p.py[i] - p.py[j];
          const d2 = dx * dx + dy * dy;
          if (d2 >= max * max) continue;
          const al = (1 - Math.sqrt(d2) / max) * 0.3 * perto(i);
          ctx.strokeStyle = rgba(params.nucleo, al);
          ctx.lineWidth = 0.75 * p.esc[i];
          ctx.beginPath();
          ctx.moveTo(p.px[i], p.py[i]);
          ctx.lineTo(p.px[j], p.py[j]);
          ctx.stroke();
        }
      }
    }

    for (let a = 0; a < o.length; a++) {
      const i = o[a];
      const d = perto(i);
      const cor: RGB = [
        params.tras[0] + (params.frente[0] - params.tras[0]) * d,
        params.tras[1] + (params.frente[1] - params.tras[1]) * d,
        params.tras[2] + (params.frente[2] - params.tras[2]) * d,
      ];
      ctx.fillStyle = rgba(cor, p.alfa[i] * (0.25 + 0.75 * d));
      ctx.beginPath();
      ctx.arc(p.px[i], p.py[i], p.tam[i] * p.esc[i] * this.reforco, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
