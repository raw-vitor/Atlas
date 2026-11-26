"use client";
import { useEffect, useRef } from "react";
import type { OrbEstado } from "./orb/estados";
import { registrar, remover } from "./orb/loop";
import { MotorEsfera } from "./orb/motor";

export type { OrbEstado };

interface Props {
  tamanho?: number;
  estado?: OrbEstado;
  /** false desenha um quadro estático (avatares de mensagens antigas). */
  animado?: boolean;
  /** Anéis de aura em volta. Padrão: só a partir de 96 px. */
  aura?: boolean;
}

export function AtlasOrb({ tamanho = 40, estado = "parado", animado = true, aura }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motor = useRef<MotorEsfera | null>(null);
  const estadoAtual = useRef<OrbEstado>(estado);
  const comAura = aura ?? tamanho >= 96;

  useEffect(() => {
    estadoAtual.current = estado;
    motor.current?.definirEstado(estado);
  }, [estado]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const estatico = !animado || reduz;
    const m = new MotorEsfera(el, { tamanho, estado: estadoAtual.current, estatico });
    motor.current = m;
    let io: IntersectionObserver | undefined;
    if (!estatico) {
      io = new IntersectionObserver(([e]) => { m.visivel = e.isIntersecting; });
      io.observe(el);
      registrar(m);
    }
    const aoRedimensionar = () => m.redimensionar();
    window.addEventListener("resize", aoRedimensionar);
    return () => {
      window.removeEventListener("resize", aoRedimensionar);
      io?.disconnect();
      remover(m);
      motor.current = null;
    };
  }, [tamanho, animado]);

  return (
    <div
      role="img" aria-label={`Atlas, ${estado}`} className="atlas-orb" data-estado={estado}
      style={{ width: tamanho, height: tamanho }}
    >
      {comAura && <><span className="atlas-orb-aura" /><span className="atlas-orb-aura atlas-orb-aura-externa" /></>}
      <canvas ref={canvas} style={{ width: tamanho, height: tamanho, display: "block" }} aria-hidden />
    </div>
  );
}
