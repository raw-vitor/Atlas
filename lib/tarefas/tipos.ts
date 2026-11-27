/** Tipos compartilhados entre as rotas, o consumidor da fila e o Durable Object `Conversa`. Só tipos: sem dependência de runtime. */

export type Faixa = 60 | 85 | 95;
export const FAIXAS: readonly Faixa[] = [60, 85, 95];

export type TipoTarefa = "turno" | "deck";
export type StatusTarefa = "na_fila" | "rodando" | "concluida" | "cancelada" | "erro";
export type StatusFinal = Exclude<StatusTarefa, "na_fila" | "rodando">;

/** Igual a `TarefaPublica` de docs/CONTRATO_API.md. */
export interface TarefaPublica {
  id: string;
  tipo: TipoTarefa;
  status: StatusTarefa;
  posicao?: number;
  iniciada: number;
}

/**
 * Corpo das mensagens de `atlas-tarefas`. O conteúdo do lead nunca viaja na fila: o texto do assessor e os anexos já estão
 * em D1/R2, e o que o consumidor precisa para executar fica no `payload` da tarefa dentro do DO (`iniciarTarefa`).
 */
export type MensagemTarefa =
  | { tipo: "turno"; conversaId: string; usuarioId: string; tarefaId: string }
  | { tipo: "deck"; conversaId: string; usuarioId: string; tarefaId: string }
  | { tipo: "purga"; conversaId: string; usuarioId: string };

export const TIPOS_FILA = ["turno", "deck", "purga"] as const;

/** Resultado de `iniciarTarefa`: ou a trava foi pega, ou já havia tarefa em andamento (a rota responde 409). */
export type ResultadoIniciar =
  | { ok: true; ocupado?: undefined; tarefa: TarefaPublica }
  | { ok: false; ocupado: true; tarefa: TarefaPublica }
  | { ok: false; ocupado?: undefined; purgada: true };

/** Resultado de `comecarTarefa`, chamado pelo consumidor da fila ao receber a mensagem. */
export type ResultadoComecar =
  | { ok: true; tarefa: TarefaPublica; payload: unknown }
  | { ok: false; motivo: "inexistente" | "encerrada" | "em_execucao" | "purgada"; tarefa: TarefaPublica | null };

export interface EstadoConversa {
  tarefa: TarefaPublica | null;
  contexto: unknown | null;
  alertasVistos: Faixa[];
  purgada: boolean;
}
