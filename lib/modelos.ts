import { config } from "@/lib/config";

/**
 * Janela de contexto (tokens de entrada) por família de modelo do Bedrock.
 * O Converse não devolve esse dado, então a tabela fica aqui.
 *
 * Fontes (conferidas em 2026):
 * - Tabela "All models": https://platform.claude.com/docs/en/models/overview
 * - Janela de 1M é o padrão dos modelos que têm 1M (sem cabeçalho beta):
 *   https://platform.claude.com/docs/en/build-with-claude/context-windows
 * - Sonnet 4.6: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html (1M)
 * - Opus 4.6: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-6.html (1M)
 * - Sonnet 4.5: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-5.html (200K)
 * - Modelos anteriores ao 4.6 que não estão na lista abaixo: a própria Anthropic diz que têm 200K.
 *
 * Opus 4.7, 4.8 e a família Claude 5 têm 1M na tabela da Anthropic. Os ids Claude 5 e Opus 4.7 conferi na lista de ids do Bedrock; a janela do Bedrock para 4.8 não conferi.
 */
const JANELAS: ReadonlyArray<readonly [familia: string, tokens: number]> = [
  // Ordem importa: a família mais específica vem antes.
  ["claude-opus-5", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-haiku-5", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4-5", 200_000],
  ["claude-opus-4-1", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-4-5", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4-5", 200_000],
  ["claude-3-7-sonnet", 200_000],
  ["claude-3-5-sonnet", 200_000],
  ["claude-3-5-haiku", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
];

const JANELA_PADRAO = 200_000;

// Remove prefixo de inferência regional (us., eu., apac., global.) e o provedor (anthropic.).
function normalizar(modelId: string): string {
  return modelId.trim().toLowerCase()
    .replace(/^(?:us-gov|us|eu|apac|jp|au|global)\./, "")
    .replace(/^anthropic\./, "");
}

/** Janela de contexto (tokens de entrada) do modelo. Desconhecido: 200 mil. */
export function janelaContexto(modelId: string): number {
  const id = normalizar(modelId);
  for (const [familia, tokens] of JANELAS) {
    if (id === familia || id.startsWith(`${familia}-`)) return tokens;
  }
  return JANELA_PADRAO;
}

/** Limite usado pelo medidor: ATLAS_CONTEXTO_TOKENS se > 0, senão a janela do modelo em uso. */
export function limiteContexto(): number {
  return config.contextoTokens > 0 ? config.contextoTokens : janelaContexto(config.modelId);
}

/** Faixas de alerta do medidor, em porcentagem. */
export const FAIXAS = [60, 85, 95] as const;

/** Faixa atingida por uma porcentagem: 0 abaixo de 60, depois 60, 85 e 95. */
export function faixaDe(pct: number): 0 | 60 | 85 | 95 {
  if (pct >= 95) return 95;
  if (pct >= 85) return 85;
  if (pct >= 60) return 60;
  return 0;
}
