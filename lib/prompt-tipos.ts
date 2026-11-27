/**
 * Contrato da configuração do prompt por assessor.
 * Módulo puro, sem dependências de servidor: é importado pelo catálogo (`lib/prompt-blocos.ts`), pelas rotas e pela página.
 */

export const CATEGORIAS = ["geral", "carteira", "lead", "proposta", "diagnostico", "decisao", "notas"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Etapas com LLM que a configuração afeta (só as do lead e do slide; OCR, triagem e leitura do chat ficam fora). `geral` vale em todas. */
export const ETAPAS = ["ativos", "ativos_transcricao", "lead", "alocacao", "diagnostico", "decisao", "notas"] as const;
export type Etapa = (typeof ETAPAS)[number];

/** Categoria de cada etapa: os blocos da categoria entram só nas etapas dela (mais os de `geral`). */
export const CATEGORIA_DA_ETAPA: Record<Etapa, Categoria> = {
  ativos: "carteira", ativos_transcricao: "carteira", lead: "lead", alocacao: "proposta",
  diagnostico: "diagnostico", decisao: "decisao", notas: "notas",
};

export interface InfoCategoria {
  id: Categoria;
  titulo: string;        // "Diagnóstico"
  descricao: string;     // uma frase para o assessor
  slides: string[];      // slides que mudam, ex.: ["Disse × números", "Riscos"]
  referencia: string[];  // arquivos da base de conhecimento usados (só o nome; a base não é editável), ex.: ["04 Diagnóstico da carteira"]
}

export interface BlocoBase {
  id: string;            // estável, ex.: "geral.tom", "diagnostico.riscos"
  categoria: Categoria;
  titulo: string;
  ajuda: string;         // o que muda no deck se o assessor mexer aqui
  texto: string;         // trecho exato do prompt original
  travado?: boolean;     // compliance: só leitura
  hash: string;          // hashBase(texto)
}

export interface BlocoAlterado { texto: string; ativo: boolean; baseHash: string }

export interface BlocoExtra {
  id: string;            // gerado no cliente: "x_" + 12 a 32 caracteres [a-z0-9]
  categoria: Categoria;
  titulo: string;
  texto: string;
  ativo: boolean;
  ordem: number;
}

/** O que é gravado por usuário: só a diferença em relação ao original. */
export interface DadosConfig {
  alterados: Record<string, BlocoAlterado>;
  extras: BlocoExtra[];
}

export interface ConfigPrompt extends DadosConfig { versao: number }

export const configVazia = (versao = 0): ConfigPrompt => ({ versao, alterados: {}, extras: [] });

export const LIMITES = {
  textoBloco: 1500,
  tituloBloco: 60,
  extras: 20,
  extrasPorEtapa: 6000, // soma dos textos dos extras ativos que entram numa etapa (geral + a categoria dela)
} as const;

/**
 * API `/api/configuracoes/prompt`
 *   GET    -> 200 RespostaConfig
 *   PUT    corpo CorpoPut -> 200 RespostaConfig | 400 { erro } | 409 { erro, atual: RespostaConfig }
 *   DELETE -> 200 RespostaConfig (config vazia com versao + 1; a linha não é apagada)
 * Sem linha para o usuário: versao 0.
 */
export interface RespostaConfig {
  categorias: InfoCategoria[];
  blocos: BlocoBase[];
  config: ConfigPrompt;
  /** Caracteres da base de conhecimento por etapa (0 = etapa sem base), para a prévia "Ver prompt final". */
  tamanhoKb: Record<Etapa, number>;
}

export interface CorpoPut extends DadosConfig { versao: number }

/** Versões da config usadas no caso (alerta de versão anterior). Ausente = etapa ainda não rodou. */
export interface ConfigVersoes { lead?: number; rascunho?: number }

/** FNV-1a 32 bits em 8 hex. Só para detectar mudança do texto original; não é segurança. */
export function hashBase(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
