/**
 * Chaves e operações em lote do bucket `atlas-arquivos` (R2).
 *
 *   u/{usuarioId}/c/{conversaId}/anexos/{id}-{nome}
 *   u/{usuarioId}/c/{conversaId}/fontes/{hash}.txt
 *   u/{usuarioId}/c/{conversaId}/decks/v{n}.pptx | v{n}.pdf
 *
 * O prefixo por usuário e conversa permite apagar tudo de uma conversa listando o prefixo. O bucket não é público: o download
 * passa por uma rota que confere o dono antes de ler o objeto.
 */

/** Prefixo de tudo o que a conversa guarda. Termina em "/", para que `c/ab` não case com `c/abc`. */
export const chaveConversa = (usuarioId: string, conversaId: string) => `u/${usuarioId}/c/${conversaId}/`;

/**
 * Anexo. `hash` é qualquer identificador sem "/" que torne a chave única: o upload chega em streaming, então o hash do conteúdo
 * não existe antes de gravar. A rota de upload usa um id aleatório (docs/CONTRATO_API.md).
 */
export const chaveAnexo = (usuarioId: string, conversaId: string, hash: string, nome: string) =>
  `${chaveConversa(usuarioId, conversaId)}anexos/${hash}-${nomeSeguro(nome)}`;

/** Texto extraído de uma fonte (transcrições chegam a 200 mil caracteres, grande demais para o SQLite do DO). */
export const chaveFonte = (usuarioId: string, conversaId: string, hash: string) =>
  `${chaveConversa(usuarioId, conversaId)}fontes/${hash}.txt`;

export const chaveDeck = (usuarioId: string, conversaId: string, versao: number, fmt: "pptx" | "pdf") =>
  `${chaveConversa(usuarioId, conversaId)}decks/v${versao}.${fmt}`;

const MAX_NOME = 120;

/**
 * Nome de arquivo sem separadores de caminho nem caracteres de controle, com no máximo MAX_NOME caracteres (a extensão é mantida).
 * Nunca devolve vazio nem "." / "..".
 */
export function nomeSeguro(nome: string): string {
  let n = nome.normalize("NFC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  n = n.replace(/^\.+/, "_"); // sem ".", ".." nem arquivo oculto
  if (n.length > MAX_NOME) {
    const i = n.lastIndexOf(".");
    const ext = i > 0 && n.length - i <= 10 ? n.slice(i) : "";
    n = n.slice(0, MAX_NOME - ext.length) + ext;
  }
  return n || "arquivo";
}

/** A chave de anexo pertence a esta conversa deste usuário? Barra chaves de outra conversa, de outro usuário, e ".." ou "//". */
export function chaveDeAnexoValida(usuarioId: string, conversaId: string, chave: unknown): chave is string {
  if (typeof chave !== "string" || chave.length > 1024) return false;
  const prefixo = `${chaveConversa(usuarioId, conversaId)}anexos/`;
  if (!chave.startsWith(prefixo)) return false;
  const resto = chave.slice(prefixo.length);
  return resto.length > 0 && !resto.includes("/") && !/[\u0000-\u001f\u007f]/.test(resto);
}

/** Nome do arquivo a partir da chave `…/anexos/{id}-{nome}`. */
export function nomeDaChave(chave: string): string {
  const base = chave.slice(chave.lastIndexOf("/") + 1);
  return base.slice(base.indexOf("-") + 1) || base;
}

/**
 * Apaga todos os objetos do prefixo, listando de 1000 em 1000. Idempotente. Devolve quantos objetos apagou.
 * Só aceita o prefixo de uma conversa (`u/{usuario}/c/{conversa}/`): nunca apaga o bucket inteiro por engano.
 */
export async function apagarPrefixo(bucket: R2Bucket, prefixo: string): Promise<number> {
  if (!/^u\/[^/]+\/c\/[^/]+\/$/.test(prefixo)) throw new Error("Prefixo de R2 inválido para apagar");
  let total = 0;
  // Sem cursor: apagar a página e listar de novo evita depender do cursor depois das remoções e pega o que sobrou.
  for (;;) {
    const pagina = await bucket.list({ prefix: prefixo, limit: 1000 });
    if (!pagina.objects.length) return total;
    await bucket.delete(pagina.objects.map((o) => o.key));
    total += pagina.objects.length;
  }
}
