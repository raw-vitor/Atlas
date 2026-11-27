export type Classe = "Pós-fixado" | "Pré-fixado" | "Inflação (IPCA+)" | "Multimercado" | "RF Internacional" | "RV Internacional" | "Ações Brasil" | "FIIs" | "Alternativos";

export interface Ativo {
  nome: string; emissor: string; classe: Classe; subclasse: string; liquidez: string;
  vencimento: string; valor: number; fora_do_depara: boolean;
}
export interface AtivosOut { ativos: Ativo[]; data_posicao: string }
export interface Lead {
  primeiro_nome: string; situacao: string[]; objetivos: string[]; restricoes: string[]; frases_literais: string[];
  perfil: string; freio_principal: string; aporte_mensal: number; meta_patrimonio_citada: string; lacunas: string[];
}
export interface ClasseAlvo { classe: Classe; pct_proposto: number; para_detalhe: string; porque: string; objetivo: string; fase: 1 | 2 | 3 }
export interface Alocacao {
  titulo_slide: string; classes: ClasseAlvo[]; cards: { titulo: string; texto: string }[];
  fases: { fase: number; descricao: string }[]; sub_rf_texto: string;
}
export interface Diagnostico {
  frase_contradicao: string;
  disse: { frase: string; numero: string; leitura: string }[]; titulo_disse: string;
  acertos: { numero: string; titulo: string; texto: string }[]; titulo_acertou: string;
  riscos: { rotulo: string; numero: string; texto: string }[]; titulo_riscos: string;
  ganho_titulo: string; ganho_numero: string; ganho_descricao: string; ganho_detalhes: string[];
  ganho_passos: { titulo: string; texto: string }[]; falta: { titulo: string; texto: string }[]; perguntas: string[];
}
export interface Decisao {
  hoje_numero: string; hoje_texto: string; hoje_detalhes: string[]; pedido: string; garantias: string[];
  condicoes: string[]; resumo_itens: string[]; frase_lead_repete: string; diferencial_motivo: string;
}
export type Notas = Record<string, string>;

export type TipoAviso = "valor" | "citacao" | "alocacao" | "promessa" | "proibido" | "emissor" | "leitura";
/** Aviso do método. A UI e o deck-service recebem só `texto`; o resto serve para explicar o aviso no chat. */
export interface Aviso {
  tipo: TipoAviso;
  /** Frase pronta para a tela (diz onde e por quê). */
  texto: string;
  /** Por que o aviso existe, em linguagem do assessor (ex.: "não está nos números calculados nem na fala do lead"). */
  motivo: string;
  valor?: number;
  /** Onde está, traduzido para o slide (ex.: "slide A Decisão, número de hoje"). */
  campo?: string;
  /** Trecho do texto em que o problema aparece. */
  trecho?: string;
  /** Quantas vezes o mesmo problema aparece (avisos deduplicados). */
  ocorrencias?: number;
}

export interface Analise {
  total: number;
  por_classe: Record<string, number>;
  pct_classe: Record<string, number>;
  subclasses: Record<string, number>;
  excedente_fgc: number;
  excedente_fgc_a_validar: boolean;
  pct_internacional: number;
  pct_local: number;
  maior_ativo: [string, number] | null;
  n_ativos: number;
  n_classes: number;
  fora_do_estudo: [string, number][];
}
