import type { ConfigVersoes } from "@/lib/prompt-tipos";

/**
 * Alerta de versão anterior das instruções. Funções puras, sem rede nem DOM.
 * `versoes` vem de `caso.configVersoes` (o que o servidor gravou ao ler o lead e ao gerar o rascunho) e `atual` de `configAtual`.
 */

/**
 * Alguma etapa já feita usou uma versão diferente da atual. Sem versão gravada (conversa sem lead nem rascunho, ou caso salvo antes
 * do recurso) não há o que comparar; sem `atual` (ainda não carregou) também não.
 */
export function versaoDesatualizada(versoes: ConfigVersoes | null | undefined, atual: number | null | undefined): boolean {
  if (typeof atual !== "number") return false;
  return [versoes?.lead, versoes?.rascunho].some((v) => typeof v === "number" && v !== atual);
}

/** Identifica "esta conversa, estas versões usadas, esta versão atual": dispensar vale para ela e volta se qualquer uma mudar. */
export function chaveDispensa(conversaId: string, versoes: ConfigVersoes | null | undefined, atual: number | null | undefined): string {
  return `atlas.config-alerta:${conversaId}:${versoes?.lead ?? "-"}:${versoes?.rascunho ?? "-"}>${atual ?? "-"}`;
}

/** O assessor tem alguma personalização que muda o prompt: bloco original editado ou desligado, ou instrução própria ligada. */
export function temPersonalizacao(config: { alterados?: Record<string, unknown>; extras?: { ativo: boolean }[] } | null | undefined): boolean {
  if (!config) return false;
  return Object.keys(config.alterados ?? {}).length > 0 || (config.extras ?? []).some((x) => x.ativo);
}

export const TEXTO_VERSAO_ANTERIOR = "Esta conversa foi gerada com uma versão anterior das suas instruções. As mudanças feitas depois não valem aqui.";

const ID_CONVERSA = /^[0-9a-f]{32}$/;

/** Id de conversa válido (32 hex). Qualquer outra coisa vinda da URL é descartada: nada de redirecionamento aberto. */
export function idConversaValido(valor: unknown): valor is string {
  return typeof valor === "string" && ID_CONVERSA.test(valor);
}

/** Destino da engrenagem: a página de instruções, lembrando a conversa aberta para o "Voltar ao chat". */
export function hrefConfig(conversaId: string | null | undefined): string {
  return idConversaValido(conversaId) ? `/configuracoes/prompt?voltar=${conversaId}` : "/configuracoes/prompt";
}

/** Destino do "Voltar ao chat": sempre um caminho interno fixo; o id só entra se for válido. */
export function hrefChat(voltar: unknown): string {
  return idConversaValido(voltar) ? `/?c=${voltar}` : "/";
}
