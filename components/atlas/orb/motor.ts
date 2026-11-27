import { ESTADOS, interpolar, nivel, type OrbEstado, type ParametrosEstado } from "./estados";
import { desenharEnxame, dinamicaInicial, geometriaPara, nivelDetalhe, Projecao, type Dinamica, type Geometria } from "./enxame";

const TRANSICAO = 0.2; // constante de tempo (s) da troca de estado, ~600 ms para assentar
const TAU = Math.PI * 2;
/** Ampliação da esfera enquanto processa: +60%. */
export const AMPLIACAO = 1.6;
const SPIN_CONSTEL = 0.32; // fração da rotação mantida na constelação, como na 02·F
// Molas críticas (sem quique) na constelação: assentam em ~1,8 s na ida e ~1,4 s na volta.
const OMEGA_IDA = 2.6;
const OMEGA_VOLTA = 3.3;
// Ampliação em ease-out: aproxima o alvo com velocidade máxima no início e freando até assentar, sem quique.
const TAU_AMP_IDA = 0.32;
const TAU_AMP_VOLTA = 0.28;
const suave = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface OpcoesMotor {
  tamanho: number;
  estado: OrbEstado;
  estatico?: boolean;
  /** Fator máximo de ampliação reservado no canvas (1 = sem folga). */
  folga?: number;
}

export class MotorEsfera {
  visivel = true;
  /** Chamado uma vez quando a esfera termina de voltar da constelação. */
  aoAssentar?: () => void;
  /** Ampliação atual (1 a AMPLIACAO), com ease-out próprio. */
  amp = 1; private ampVel = 0; private ampAlvo = 1;
  private folga = 1;
  private cm = 0; private cmVel = 0; private cmAlvo = 0; private avisou = true;
  private ctx: CanvasRenderingContext2D;
  private geo: Geometria;
  private proj: Projecao;
  private detalhe: boolean;
  private t = 1;
  private estado: OrbEstado;
  private params: ParametrosEstado;
  private d: Dinamica = dinamicaInicial();
  private estatico: boolean;
  private tamanho: number;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, op: OpcoesMotor) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d indisponível");
    this.ctx = ctx;
    this.tamanho = op.tamanho;
    this.folga = Math.max(1, op.folga ?? 1);
    this.estado = op.estado;
    this.estatico = !!op.estatico;
    this.params = ESTADOS[op.estado];
    const nv = nivelDetalhe(op.tamanho);
    this.detalhe = nv.detalhe;
    this.geo = geometriaPara(nv);
    this.cmAlvo = this.alvoConstel(op.estado);
    if (this.estatico) this.cm = this.cmAlvo; else if (this.cmAlvo === 1) this.avisou = false;
    this.proj = new Projecao(this.geo.n, this.geo.arestas.length / 2, this.geo.arestasC.length / 2);
    this.d.level = nivel(op.estado, this.t);
    this.redimensionar();
  }

  /** A constelação só existe com detalhe e no estado "pensando". */
  private alvoConstel(e: OrbEstado) { return this.detalhe && e === "pensando" ? 1 : 0; }

  definirEstado(e: OrbEstado) {
    this.estado = e;
    this.cmAlvo = this.alvoConstel(e);
    if (this.cmAlvo === 1) this.avisou = false;
    if (this.estatico) {
      this.cm = this.cmAlvo;
      if (this.cmAlvo === 0) this.aoAssentar?.();
      this.params = ESTADOS[e];
      this.d.level = nivel(e, this.t);
      this.desenhar();
    }
  }

  definirAmpliacao(ligada: boolean) {
    this.ampAlvo = ligada && this.folga >= AMPLIACAO ? AMPLIACAO : 1;
    if (this.ampAlvo > 1 || this.amp > 1.002) this.avisou = false;
    if (this.estatico) { this.amp = this.ampAlvo; this.ampVel = 0; this.desenhar(); }
  }

  redimensionar() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(1, Math.round(this.tamanho * this.folga * this.dpr));
    this.canvas.width = px;
    this.canvas.height = px;
    this.desenhar();
  }

  quadro(dt: number) {
    this.t += dt;
    const { d } = this;
    this.params = interpolar(this.params, ESTADOS[this.estado], 1 - Math.exp(-dt / TRANSICAO));
    const p = this.params;
    this.molaConstel(dt);
    this.molaAmp(dt);
    // Muda a velocidade, nunca o ângulo acumulado: sem tranco ao desacelerar.
    d.yaw += p.spin * (1 - (1 - SPIN_CONSTEL) * suave(0.4, 1, this.cm)) * dt;
    d.flow += p.flow * dt;
    d.sig += p.sig * dt;
    d.prec += 0.12 * dt;
    d.wave += (1.1 + Math.max(0, p.wave) * 2.2) * dt;
    d.breath = 0.5 - 0.5 * Math.cos((this.breathPh += TAU * p.breath * dt));
    // Sobe rápido e desce devagar, como um envelope de áudio
    const alvo = nivel(this.estado, this.t);
    d.level += (alvo - d.level) * (1 - Math.exp(-dt / (alvo > d.level ? 0.045 : 0.17)));
    this.desenhar();
  }

  private breathPh = 0;

  private molaAmp(dt: number) {
    const tau = this.ampAlvo > 1 ? TAU_AMP_IDA : TAU_AMP_VOLTA;
    this.amp += (this.ampAlvo - this.amp) * (1 - Math.exp(-dt / tau));
    this.ampVel = 0;
    if (this.ampAlvo === 1 && this.amp < 1.002) { this.amp = 1; this.ampVel = 0; }
    this.verificarAssentou();
  }

  private verificarAssentou() {
    if (this.avisou || this.cmAlvo !== 0 || this.ampAlvo !== 1) return;
    if (this.cm < 0.002 && this.amp <= 1.002) {
      this.cm = 0; this.cmVel = 0; this.amp = 1; this.ampVel = 0; this.avisou = true;
      this.aoAssentar?.();
    }
  }

  private molaConstel(dt: number) {
    const w = this.cmAlvo > this.cm || this.cmAlvo === 1 ? OMEGA_IDA : OMEGA_VOLTA;
    const n = Math.max(1, Math.ceil(dt / 0.016)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.cmVel += (-w * w * (this.cm - this.cmAlvo) - 2 * w * this.cmVel) * h;
      this.cm += this.cmVel * h;
    }
  }

  /**
   * Fator do raio desenhado. Ampliado, a esfera fica AMPLIACAO vezes o tamanho em repouso: compensa a contração
   * do estado atual (o "pensando" encolhe a esfera em 3,5%), senão o crescimento visível seria só ~25%.
   */
  private raioAmp() {
    const t = (this.amp - 1) / (AMPLIACAO - 1);
    return this.amp * (1 + (1 / this.params.scale - 1) * t);
  }

  private desenhar() {
    const { ctx, params: p, tamanho } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const lado = tamanho * this.folga;
    ctx.clearRect(0, 0, lado, lado);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    desenharEnxame(this.geo, this.proj, {
      ctx, tamanho, lado, amp: this.raioAmp(), d: this.d,
      constel: Math.min(1, Math.max(0, this.cm)), conv: p.conv, wave: p.wave, route: p.route, focus: p.focus, glow: p.glow, scale: p.scale, fixo: p.fixo,
      frente: p.frente, tras: p.tras, nucleo: p.nucleo, linha: p.linha, quente: p.quente,
    }, this.detalhe);
  }
}
