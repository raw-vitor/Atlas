/** Tipos da API de conversas (docs/CONTRATO_API.md, "Tipos"). Só tipos: sem dependência de runtime. */
import type { Resultado } from "../../components/chat/types";

export type { Faixa, TarefaPublica } from "../tarefas/tipos";

export interface ConversaResumo {
  id: string;
  titulo: string;
  criada: number;
  atualizada: number;
  ctxTokens: number;
  ctxLimite: number;
}

export interface Anexo {
  /** Chave no R2: `u/{usuario}/c/{conversa}/anexos/{id}-{nome}`. */
  chave: string;
  nome: string;
  tamanho: number;
  tipo: string;
}

export interface MensagemSalva {
  id: string;
  seq: number;
  idCliente?: string;
  criada: number;
  tipo: "usuario" | "atlas" | "resultado";
  texto?: string;
  meta?: { anexos?: Anexo[]; erro?: boolean; versao?: number; resultado?: Resultado };
}

export interface Contexto {
  tokens: number;
  limite: number;
  pct: number;
  estimado: boolean;
  partes: { transcricao: number; carteira: number; historico: number; outros: number };
}

/** Payload guardado no DO por `iniciarTarefa("turno", ...)`. Dono do formato: as rotas; leitor: o consumidor. */
export type PayloadTurno = { texto: string; anexos: Anexo[]; mensagemId: string };
/** Payload guardado no DO por `iniciarTarefa("deck", ...)`. */
export type PayloadDeck = { acao: "gerar" };
