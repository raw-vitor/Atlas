export interface Resultado {
  arquivos: Record<string, string>; avisos: string[]; pendencias: string[];
  resumo: { lead: string; total: number; perfil: string };
  tokens: { chamadas: number; entrada: number; saida: number };
}
export interface Evento { id: string; status: string; etapa: string; pct: number; msg: string; erro: string; resultado: Resultado | null }

export type Mensagem =
  | { id: string; tipo: "usuario"; texto: string; anexos: string[] }
  | { id: string; tipo: "atlas"; texto: string; erro?: boolean }
  | { id: string; tipo: "progresso"; jobId: string; evento: Evento | null }
  | { id: string; tipo: "resultado"; jobId: string; resultado: Resultado };

export interface Conversa { id: string; titulo: string; mensagens: Mensagem[]; ocupada: boolean; caso?: CasoPublico }

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
