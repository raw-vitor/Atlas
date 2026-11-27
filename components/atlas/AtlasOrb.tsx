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
  /** Chamado quando a esfera termina de voltar da constelação (ou de imediato, com movimento reduzido). */
  aoAssentar?: () => void;
  /** Fator máximo de crescimento cujo espaço já fica reservado (ex.: 1,6). Padrão 1: sem reserva. */
  crescimento?: number;
  /** Amplia a esfera até `crescimento` (animado) enquanto for true. */
  ampliar?: boolean;
}

export function AtlasOrb({ tamanho = 40, estado = "parado", animado = true, aura, aoAssentar, crescimento = 1, ampliar = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const motor = useRef<MotorEsfera | null>(null);
  const estadoAtual = useRef<OrbEstado>(estado);
  const aoAssentarRef = useRef(aoAssentar);
  const ampliarRef = useRef(ampliar);
  const lado = Math.round(tamanho * crescimento);
  const comAura = aura ?? tamanho >= 96;

  useEffect(() => { aoAssentarRef.current = aoAssentar; }, [aoAssentar]);

  useEffect(() => {
    ampliarRef.current = ampliar;
    motor.current?.definirAmpliacao(ampliar);
  }, [ampliar]);

  useEffect(() => {
    estadoAtual.current = estado;
    motor.current?.definirEstado(estado);
  }, [estado]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const estatico = !animado || reduz;
    const m = new MotorEsfera(el, { tamanho, estado: estadoAtual.current, estatico, folga: crescimento });
    motor.current = m;
    m.definirAmpliacao(ampliarRef.current);
    m.aoAssentar = () => aoAssentarRef.current?.();
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
  }, [tamanho, animado, crescimento]);

  return (
    <div
      role="img" aria-label={`Atlas, ${estado}`} className="atlas-orb" data-estado={estado}
      style={{ width: lado, height: lado, ["--orb" as string]: `${tamanho}px` }}
    >
      {comAura && <><span className="atlas-orb-aura" /><span className="atlas-orb-aura atlas-orb-aura-externa" /></>}
      <canvas ref={canvas} style={{ width: lado, height: lado, display: "block" }} aria-hidden />
    </div>
  );
}
