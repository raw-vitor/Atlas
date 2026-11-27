/**
 * Prompts de app/llm/knowledge.py e app/llm/steps.py. PAPEL e TAREFA_* agora saem do catálogo de blocos
 * (lib/prompt-blocos.ts) com o mesmo valor de antes, caractere por caractere (tests/prompt-blocos.test.ts).
 */
import { textoPapel, textoTarefa } from "./prompt-blocos";

export const PAPEL = textoPapel();
export const TAREFA_ATIVOS = textoTarefa("ativos");
export const TAREFA_LEAD = textoTarefa("lead");
export const TAREFA_ATIVOS_TRANSCRICAO = textoTarefa("ativos_transcricao");
export const TAREFA_ALOCACAO = textoTarefa("alocacao");
export const TAREFA_DIAGNOSTICO = textoTarefa("diagnostico");
export const TAREFA_DECISAO = textoTarefa("decisao");
export const TAREFA_NOTAS = textoTarefa("notas");

export const PROMPT_IMAGEM =
  "Transcreva fielmente todo o texto desta imagem, sem resumir nem interpretar. " +
  "Tabela: uma linha por linha da tabela, colunas separadas por |, mantendo o cabeçalho. " +
  "Diálogo ou conversa: uma fala por linha, no formato 'Nome: fala'. " +
  "Texto corrido: mantenha os parágrafos. Ignore CPF e número de conta.";

export const msgRetry = (erro: string) =>
  `A resposta anterior foi inválida (${erro}). Corrija exatamente esse ponto e responda de novo só com o JSON do schema.`;
