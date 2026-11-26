import type { MotorEsfera } from "./motor";

// Um único requestAnimationFrame para todas as esferas da página.
const motores = new Set<MotorEsfera>();
let raf = 0;
let ultimo = 0;
let ouvindo = false;

function tick(agora: number) {
  raf = 0;
  if (!motores.size || document.hidden) return;
  const dt = Math.min(0.05, Math.max(0, (agora - ultimo) / 1000));
  ultimo = agora;
  motores.forEach((m) => { if (m.visivel) m.quadro(dt); });
  raf = requestAnimationFrame(tick);
}

function iniciar() {
  if (raf || document.hidden || !motores.size) return;
  ultimo = performance.now();
  raf = requestAnimationFrame(tick);
}

function aoMudarVisibilidade() {
  if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else iniciar();
}

export function registrar(m: MotorEsfera) {
  if (!ouvindo) { document.addEventListener("visibilitychange", aoMudarVisibilidade); ouvindo = true; }
  motores.add(m);
  iniciar();
}

export function remover(m: MotorEsfera) {
  motores.delete(m);
  if (!motores.size) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ouvindo) { document.removeEventListener("visibilitychange", aoMudarVisibilidade); ouvindo = false; }
  }
}
