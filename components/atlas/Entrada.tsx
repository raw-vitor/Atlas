"use client";
import { useEffect, useRef, useState } from "react";
import { AtlasOrb } from "./AtlasOrb";

/**
 * Entrada animada logo depois do login (versão leve, docs/PLANO_TRANSICAO_LOGIN.md).
 * A tela de login do Access não aceita JavaScript e fica em outro domínio, então a animação roda aqui, no chat:
 * o primeiro quadro imita o fim da tela de login (verde à esquerda, cartão à direita) e segue até o chat.
 *
 * Fases: inicio (quadro do servidor) → abrindo (verde cobre a tela, esfera vai ao centro) → aguardando (até o chat
 * carregar) → saindo (fundo clareia, esfera encolhe até o lugar dela) → revelando (lista, input e texto entram) → fim.
 * O ChatShell lê a fase em `data-entrada` para esconder e animar os próprios elementos (app/globals.css).
 */
export type FaseEntrada = "inicio" | "abrindo" | "aguardando" | "saindo" | "revelando" | "fim";

const ABRINDO_MS = 950;
const SAINDO_MS = 800;
const REVELANDO_MS = 950;
/** Só vira "pensando" se a espera passar disso: em carga rápida a esfera não entra e sai da constelação à toa. */
const PENSAR_APOS_MS = 700;
/** Rede de segurança: com o chat travado, a entrada não prende o assessor; o chat mostra o próprio estado. */
const ESPERA_MAXIMA_MS = 15_000;

interface Props {
  fase: FaseEntrada;
  aoMudar: (f: FaseEntrada) => void;
  /** Lista e conversa ativa já carregadas (ou com erro). */
  pronto: boolean;
  /** Mesmo tamanho da esfera central do chat, para encolher até ela sem troca de escala. */
  tamanho: number;
}

export function Entrada({ fase, aoMudar, pronto, tamanho }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const esfera = useRef<HTMLDivElement>(null);
  const [pensando, setPensando] = useState(false);
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => { aoMudarRef.current = aoMudar; }, [aoMudar]);

  // inicio → abrindo: espera o quadro do servidor ser pintado para a transição de CSS ter de onde partir.
  useEffect(() => {
    if (fase !== "inicio") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { aoMudarRef.current("fim"); return; }
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => aoMudarRef.current("abrindo")); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [fase]);

  useEffect(() => {
    if (fase !== "abrindo") return;
    const t = setTimeout(() => aoMudarRef.current("aguardando"), ABRINDO_MS);
    return () => clearTimeout(t);
  }, [fase]);

  useEffect(() => {
    if (fase !== "aguardando") return;
    const p = setTimeout(() => setPensando(true), PENSAR_APOS_MS);
    const m = setTimeout(() => aoMudarRef.current("saindo"), ESPERA_MAXIMA_MS);
    return () => { clearTimeout(p); clearTimeout(m); };
  }, [fase]);

  // aguardando → saindo: mede onde está a esfera do chat (invisível, mas já no layout final) e leva esta até lá.
  // Sem esfera no chat (conversa com mensagens, erro), esta só some junto com o fundo.
  useEffect(() => {
    if (fase !== "aguardando" || !pronto || !raiz.current || !esfera.current) return;
    const alvo = document.querySelector<HTMLElement>("[data-entrada-alvo] .atlas-orb");
    if (alvo) {
      const r = alvo.getBoundingClientRect();
      esfera.current.style.setProperty("--entrada-x", `${r.left + r.width / 2 - window.innerWidth / 2}px`);
      esfera.current.style.setProperty("--entrada-y", `${r.top + r.height / 2 - window.innerHeight / 2}px`);
    } else raiz.current.dataset.semAlvo = "";
    aoMudarRef.current("saindo");
  }, [fase, pronto]);

  useEffect(() => {
    if (fase === "saindo") { const t = setTimeout(() => aoMudarRef.current("revelando"), SAINDO_MS); return () => clearTimeout(t); }
    if (fase === "revelando") { const t = setTimeout(() => aoMudarRef.current("fim"), REVELANDO_MS); return () => clearTimeout(t); }
  }, [fase]);

  if (fase === "fim") return null;
  const ampliada = fase === "inicio" || fase === "abrindo" || fase === "aguardando";
  const estado = pensando && fase === "aguardando" ? "pensando" : "parado";

  return (
    <div ref={raiz} className="entrada" data-fase={fase} aria-hidden>
      <div className="entrada-fundo" />
      <div className="entrada-cartao" />
      <div ref={esfera} className="entrada-esfera">
        <div className="entrada-esfera-escura">
          <AtlasOrb destaque fundo="escuro" tamanho={tamanho} crescimento={1.6} ampliar={ampliada} estado={estado} />
        </div>
        <div className="entrada-esfera-clara">
          <AtlasOrb destaque tamanho={tamanho} crescimento={1.6} ampliar={ampliada} estado={estado} />
        </div>
      </div>
    </div>
  );
}
