import { conferirSessao } from "../sessao";
import { urlEventos } from "./api";
import { mesclar, paraMensagem, tarefaAtiva } from "./mensagens";
import type { CasoPublico, Contexto, ConversaUI, Mensagem, MensagemSalva, StatusTarefa, TarefaPublica } from "./types";

export type EventoServidor =
  | { nome: "estado"; dados: { tarefa: TarefaPublica | null } }
  | { nome: "fila"; dados: { posicao: number } }
  | { nome: "atividade"; dados: { texto?: string; msg?: string; pct?: number } }
  | { nome: "progresso"; dados: { etapa?: string; pct: number; msg: string } }
  | { nome: "texto"; dados: { texto: string } }
  | { nome: "caso"; dados: CasoPublico }
  | { nome: "contexto"; dados: Contexto }
  | { nome: "mensagem"; dados: MensagemSalva }
  | { nome: "fim"; dados: { status: StatusTarefa } }
  | { nome: "erro"; dados: { mensagem: string } };

export const NOMES_EVENTOS = ["estado", "fila", "atividade", "progresso", "texto", "caso", "contexto", "mensagem", "fim", "erro"] as const;

/** Lê o `data:` de um evento. Devolve null se o nome for desconhecido ou o JSON, inválido. */
export function interpretarEvento(nome: string, bruto: string): EventoServidor | null {
  if (!(NOMES_EVENTOS as readonly string[]).includes(nome)) return null;
  try {
    const dados: unknown = JSON.parse(bruto);
    if (dados === null || typeof dados !== "object") return null;
    return { nome, dados } as EventoServidor;
  } catch { return null; }
}

export const AVISO_CANCELADO = "Cancelado. Nada foi alterado na conversa.";
export const AVISO_CANCELADO_DECK = "Geração dos slides cancelada.";

const semAndamento = { fila: null, atividade: null, progresso: null, parcial: null } as const;

/** Mensagem do Atlas que só existe na tela (aviso, erro). Id estável: o mesmo evento repetido não duplica. */
export const avisoLocal = (id: string, texto: string, erro = false): Mensagem => ({ id: `local-${id}`, tipo: "atlas", texto, ...(erro ? { erro: true } : {}) });

function removerMensagemDoTurno(c: ConversaUI): Mensagem[] {
  if (c.turnoMsgId) return c.mensagens.filter((m) => m.id !== c.turnoMsgId);
  // Depois de recarregar a página no meio da tarefa o id do turno não é conhecido: é a última mensagem do assessor, se for a última da conversa.
  const reais = c.mensagens.filter((m) => !m.id.startsWith("local-"));
  const ultima = reais[reais.length - 1];
  return ultima?.tipo === "usuario" ? c.mensagens.filter((m) => m !== ultima) : c.mensagens;
}

/** Aplica um evento do servidor ao estado da conversa. Pura: devolve o mesmo objeto quando nada muda. */
export function aplicarEvento(c: ConversaUI, e: EventoServidor): ConversaUI {
  switch (e.nome) {
    case "estado": {
      const t = e.dados.tarefa;
      if (!tarefaAtiva(t)) return { ...c, tarefa: t, ...semAndamento };
      return { ...c, tarefa: t, fila: t.status === "na_fila" && t.posicao != null ? t.posicao : null };
    }
    case "fila":
      return { ...c, fila: e.dados.posicao };
    case "atividade": {
      const msg = e.dados.texto ?? e.dados.msg ?? "";
      return { ...c, fila: null, atividade: msg || c.atividade,
        progresso: typeof e.dados.pct === "number" ? { pct: e.dados.pct, msg } : c.progresso };
    }
    case "progresso":
      return { ...c, fila: null, progresso: { pct: e.dados.pct, msg: e.dados.msg } };
    case "texto":
      return { ...c, fila: null, parcial: e.dados.texto };
    case "caso":
      return { ...c, caso: e.dados };
    case "contexto":
      return { ...c, contexto: e.dados };
    case "mensagem": {
      const m = paraMensagem(e.dados);
      // `erro` e a mensagem gravada com meta.erro descrevem a mesma falha: fica só a gravada.
      const base = m.tipo === "atlas" && m.erro ? c.mensagens.filter((x) => !x.id.startsWith("local-erro-")) : c.mensagens;
      return { ...c, mensagens: mesclar(base, [m]), parcial: null };
    }
    case "fim": {
      const status = e.dados.status;
      let mensagens = c.mensagens;
      if (status === "cancelada" && tarefaAtiva(c.tarefa)) {
        const deck = c.tarefa.tipo === "deck";
        if (!deck) mensagens = removerMensagemDoTurno(c);
        mensagens = mesclar(mensagens, [avisoLocal(`cancelado-${c.tarefa.id}`, deck ? AVISO_CANCELADO_DECK : AVISO_CANCELADO)]);
      }
      return { ...c, mensagens, tarefa: c.tarefa ? { ...c.tarefa, status } : null, turnoMsgId: null, ...semAndamento };
    }
    case "erro": {
      const texto = e.dados.mensagem || "Algo deu errado.";
      return { ...c, mensagens: mesclar(c.mensagens, [avisoLocal(`erro-${texto}`, texto, true)]), parcial: null };
    }
  }
}

// ---- Conexão ----

/** `expirada`: a sessão do Access venceu; a conexão não reabre e a página recarrega sozinha. */
export type EstadoConexao = "ok" | "reconectando" | "fechada" | "expirada";
export interface FonteEventos {
  readyState: number; close(): void;
  addEventListener(nome: string, fn: (ev: MessageEvent) => void): void;
  onopen: ((ev: Event) => void) | null; onerror: ((ev: Event) => void) | null;
}
export type FabricaFonte = (url: string) => FonteEventos;

const FECHADA = 2; // EventSource.CLOSED
const ESPERA_REABRIR_MS = 3000;
const MAX_REABERTURAS = 5;

/**
 * Mantém uma única conexão SSE aberta: a da conversa ativa. Abrir outra conversa fecha a anterior.
 * O EventSource reconecta sozinho (e reenvia Last-Event-ID); se o navegador desistir (HTTP de erro, ou o redirect do Access
 * com a sessão vencida), confere a sessão e, se ela segue válida, reabre algumas vezes. Sessão vencida: não reabre.
 */
export function criarGerenciadorEventos(fabrica: FabricaFonte = (u) => new EventSource(u), conferir: () => Promise<boolean> = conferirSessao) {
  let atual: { id: string; fonte: FonteEventos; timer?: ReturnType<typeof setTimeout> } | null = null;
  let geracao = 0;

  const fechar = () => {
    geracao++;
    if (atual) { clearTimeout(atual.timer); atual.fonte.close(); atual = null; }
  };

  const abrir = (id: string, aoEvento: (e: EventoServidor) => void, aoConexao: (s: EstadoConexao) => void = () => {}) => {
    if (atual?.id === id) return;
    fechar();
    const minha = geracao;
    let tentativas = 0;
    const conectar = () => {
      if (minha !== geracao) return;
      const fonte = fabrica(urlEventos(id));
      atual = { id, fonte };
      fonte.onopen = () => { if (minha === geracao) { tentativas = 0; aoConexao("ok"); } };
      for (const nome of NOMES_EVENTOS)
        fonte.addEventListener(nome, (ev) => {
          if (minha !== geracao) return;
          const e = interpretarEvento(nome, String(ev.data));
          if (e) aoEvento(e);
        });
      fonte.onerror = () => {
        if (minha !== geracao) return;
        if (fonte.readyState !== FECHADA) return aoConexao("reconectando");
        fonte.close();
        if (tentativas >= MAX_REABERTURAS) return aoConexao("fechada");
        aoConexao("reconectando");
        tentativas++;
        const espera = ESPERA_REABRIR_MS * tentativas;
        atual = { id, fonte };
        void conferir().then((vencida) => {
          if (minha !== geracao) return; // outra conversa foi aberta, ou a conexão foi fechada, enquanto conferia
          if (vencida) return aoConexao("expirada");
          atual = { id, fonte, timer: setTimeout(conectar, espera) };
        });
      };
    };
    conectar();
  };

  return { abrir, fechar, ativa: () => atual?.id ?? null };
}
