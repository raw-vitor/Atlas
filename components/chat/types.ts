// ---- Contrato com o servidor (docs/CONTRATO_API.md) ----

export type Faixa = 60 | 85 | 95;
export interface ConversaResumo { id: string; titulo: string; criada: number; atualizada: number; ctxTokens: number; ctxLimite: number }
export interface Anexo { chave: string; nome: string; tamanho: number; tipo: string }
export interface MensagemSalva {
  id: string; seq: number; idCliente?: string; criada: number;
  tipo: "usuario" | "atlas" | "resultado";
  texto?: string;
  meta?: { anexos?: Anexo[]; erro?: boolean; versao?: number; resultado?: Resultado };
}
export type StatusTarefa = "na_fila" | "rodando" | "concluida" | "cancelada" | "erro";
export interface TarefaPublica { id: string; tipo: "turno" | "deck"; status: StatusTarefa; posicao?: number; iniciada: number }
export interface Contexto {
  tokens: number; limite: number; pct: number; estimado: boolean;
  partes: { transcricao: number; carteira: number; historico: number; outros: number };
}

export interface Resultado {
  arquivos: Record<string, string>; avisos: string[]; pendencias: string[];
  resumo: { lead: string; total: number; perfil: string };
  tokens: { chamadas: number; entrada: number; saida: number };
}

export interface CasoPublico {
  id: string;
  fontes: { nome: string; papel: "carteira" | "transcricao" | "contexto"; origemPapel: string; tipo: string | null }[];
  assessor: string | null; dataR2: string | null;
  lead: { nome: string; perfil: string; objetivos: string[]; aporteMensal: number; lacunas: string[] } | null;
  carteira: { total: number; nAtivos: number; pctClasse: Record<string, number> } | null;
  avisos: string[]; pendencias: string[];
  avisosMetodo: string[]; pendenciasMetodo: string[];
  opcoes: { id: "usar_transcricao"; rotulo: string }[];
  rascunhoPronto: boolean; decks: { jobId: string; versao: number; criadoEm: number }[];
  prontidao: { pronto: boolean; faltas: string[]; faltasAcoes: string[] }; ocupado: boolean;
}

// ---- Estado da tela ----

export interface AnexoUI {
  nome: string; tamanho: number;
  status: "pendente" | "subindo" | "ok" | "erro";
  pct: number; erro?: string; chave?: string;
}

export type Mensagem =
  | { id: string; tipo: "usuario"; texto: string; anexos: AnexoUI[]; seq?: number; idCliente?: string; envio?: "enviando" | "falhou"; erro?: string }
  | { id: string; tipo: "atlas"; texto: string; erro?: boolean; seq?: number }
  | { id: string; tipo: "resultado"; resultado: Resultado; versao?: number; seq?: number };

export interface ConversaUI {
  id: string; titulo: string;
  mensagens: Mensagem[]; maisAntigas: boolean;
  carga: "carregando" | "ok" | "erro"; erroCarga?: string;
  anteriores: "ocioso" | "carregando" | "erro";
  caso: CasoPublico | null;
  tarefa: TarefaPublica | null;
  /** Posição na fila (evento `fila`); null quando a tarefa já começou. */
  fila: number | null;
  atividade: string | null;
  progresso: { pct: number; msg: string } | null;
  /** Resposta parcial do Atlas (evento `texto`) até chegar a mensagem final. */
  parcial: string | null;
  contexto: Contexto | null;
  alertasVistos: Faixa[];
  /** Envio em andamento no navegador (envio dos anexos e POST da mensagem). */
  enviando: boolean;
  /** Id da mensagem do assessor que iniciou a tarefa em andamento (some se for cancelada). */
  turnoMsgId: string | null;
}
