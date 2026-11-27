import type { ConversaUI, Mensagem, MensagemSalva, TarefaPublica } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const tarefaAtiva = (t: TarefaPublica | null | undefined): t is TarefaPublica => !!t && (t.status === "na_fila" || t.status === "rodando");
export const estaOcupada = (c: Pick<ConversaUI, "enviando" | "tarefa">) => c.enviando || tarefaAtiva(c.tarefa);

export function conversaVazia(id: string, titulo = "Nova conversa"): ConversaUI {
  return {
    id, titulo, mensagens: [], maisAntigas: false, carga: "ok", anteriores: "ocioso",
    caso: null, tarefa: null, fila: null, atividade: null, progresso: null, parcial: null,
    contexto: null, alertasVistos: [], enviando: false, turnoMsgId: null,
  };
}

/** Mensagem do servidor → mensagem da tela. */
export function paraMensagem(m: MensagemSalva): Mensagem {
  if (m.tipo === "usuario")
    return {
      id: m.id, tipo: "usuario", texto: m.texto ?? "", seq: m.seq, idCliente: m.idCliente,
      anexos: (m.meta?.anexos ?? []).map((a) => ({ nome: a.nome, tamanho: a.tamanho, status: "ok" as const, pct: 100, chave: a.chave })),
    };
  if (m.tipo === "resultado" && m.meta?.resultado)
    return { id: m.id, tipo: "resultado", resultado: m.meta.resultado, versao: m.meta.versao, seq: m.seq };
  return { id: m.id, tipo: "atlas", texto: m.texto ?? "", erro: m.meta?.erro, seq: m.seq };
}

const seqDe = (m: Mensagem) => m.seq;
const mesma = (a: Mensagem, b: Mensagem) =>
  a.id === b.id || (a.tipo === "usuario" && b.tipo === "usuario" && !!a.idCliente && a.idCliente === b.idCliente);

/**
 * Junta mensagens novas às existentes sem duplicar: o que já existe (mesmo id, ou mesmo idCliente) é substituído no lugar;
 * o resto entra na ordem de `seq`. Mensagens locais (sem `seq`) ficam onde estão.
 */
export function mesclar(existentes: readonly Mensagem[], novas: readonly Mensagem[]): Mensagem[] {
  const lista = [...existentes];
  const ordenadas = [...novas].sort((a, b) => (seqDe(a) ?? Infinity) - (seqDe(b) ?? Infinity));
  for (const n of ordenadas) {
    const i = lista.findIndex((m) => mesma(m, n));
    if (i >= 0) { lista[i] = n; continue; }
    const s = seqDe(n);
    const pos = s == null ? -1 : lista.findIndex((m) => (seqDe(m) ?? -Infinity) > s);
    if (pos < 0) lista.push(n); else lista.splice(pos, 0, n);
  }
  return lista;
}

export const menorSeq = (ms: readonly Mensagem[]): number | undefined => {
  let menor: number | undefined;
  for (const m of ms) if (m.seq != null && (menor == null || m.seq < menor)) menor = m.seq;
  return menor;
};

/** Título que o servidor dá à conversa na primeira mensagem: 60 primeiros caracteres do texto, ou o nome do primeiro anexo. */
export function tituloProvisorio(texto: string, nomesAnexos: string[]): string | null {
  const t = texto.trim().replace(/\s+/g, " ");
  if (t) return t.slice(0, 60);
  return nomesAnexos[0]?.slice(0, 60) ?? null;
}
