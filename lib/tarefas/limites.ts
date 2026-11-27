/** Limites e funções puras do Durable Object `Conversa` (sem dependência do runtime do Worker, para uso em testes Node). */

/** Sem batimento por este tempo, a tarefa ativa é considerada abandonada. Maior que o pior silêncio do Bedrock (timeout de 5 min x retries). */
export const LEASE_MS = 20 * 60_000;
/** Intervalo do comentário `: ping` do SSE (mantém proxies e o navegador de conexão aberta). */
export const PING_MS = 25_000;
/** Eventos guardados para reconexão. Os mais antigos além deste limite são descartados. */
export const MAX_EVENTOS = 2000;
/** Tamanho máximo, em caracteres, de cada linha do caso. O SQLite do DO limita a linha a 2 MB (UTF-8 chega a 4 bytes por caractere). */
export const CHUNK_CASO = 400_000;

/** Parte o texto em pedaços sem separar um par substituto (emoji): metade de um par vira U+FFFD ao gravar em UTF-8. */
export function partirTexto(texto: string, tamanho: number): string[] {
  if (texto.length <= tamanho) return [texto];
  const partes: string[] = [];
  let i = 0;
  while (i < texto.length) {
    let fim = Math.min(i + tamanho, texto.length);
    if (fim < texto.length) {
      const c = texto.charCodeAt(fim - 1);
      if (c >= 0xd800 && c <= 0xdbff) fim -= 1;
    }
    partes.push(texto.slice(i, fim));
    i = fim;
  }
  return partes;
}

export function formatarSse(evento: string, dados: unknown, id?: number): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
}
