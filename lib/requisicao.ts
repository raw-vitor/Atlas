/**
 * O OpenNext troca `globalThis.Request` por uma subclasse (`CustomRequest`) no isolate. Um `Request` nativo que chega por RPC a um
 * Durable Object nesse isolate deixa de ser `instanceof Request`, e o `Container.containerFetch` (@cloudflare/containers) então trata
 * o objeto como URL e lança "Invalid URL: [object Request]". Reconstruir o pedido com o `Request` global do isolate resolve.
 * Sem custo quando o global ainda é o nativo.
 */
export function requisicaoDoIsolate(r: Request): Request {
  return r instanceof Request ? r : new Request(r);
}
