/**
 * Montagem do system prompt com a base de conhecimento (só servidor: `kb()` embute a base inteira no bundle).
 * Catálogo, validação e resumo para a página ficam em `lib/prompt-blocos.ts`, que é importável no navegador.
 */
import { kb } from "./knowledge";
import { KB_DA_ETAPA, montarTrechos } from "./prompt-blocos";
import type { ConfigPrompt, DadosConfig, Etapa } from "./prompt-tipos";

/**
 * System prompt de uma etapa: PAPEL + "\n\nMÉTODO...:\n" + kb(...) + TAREFA, mais as instruções do assessor no fim.
 * Sem config (ou vazia) devolve exatamente o prompt de antes da configuração. Função pura.
 */
export function montarSistema(etapa: Etapa, config?: ConfigPrompt | DadosConfig): string {
  const base = KB_DA_ETAPA[etapa];
  return montarTrechos(etapa, config, base ? kb(...base.arquivos) : "").map((t) => t.texto).join("");
}

/** Tamanho em caracteres da base de conhecimento de uma etapa (0 quando a etapa não usa a base). Para o marcador do resumo. */
export function tamanhoKb(etapa: Etapa): number {
  const base = KB_DA_ETAPA[etapa];
  return base ? kb(...base.arquivos).length : 0;
}
