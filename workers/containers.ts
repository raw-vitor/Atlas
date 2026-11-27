/**
 * Containers do Atlas. Cada classe é um Durable Object que controla uma instância Docker (@cloudflare/containers).
 * Uso a partir do Worker: `env.EXTRATOR.get(env.EXTRATOR.idFromName("pool-0")).fetch(request)`; o Container sobe sob demanda
 * e dorme depois de `sleepAfter` sem requisições. Nada de segredo ou de conteúdo do lead vai em variável de ambiente.
 */
import { Container } from "@cloudflare/containers";
import { requisicaoDoIsolate } from "../lib/requisicao";

/** Base dos dois Containers: corrige o `instanceof Request` quebrado pelo OpenNext (ver lib/requisicao.ts). */
abstract class ContainerAtlas extends Container<CloudflareEnv> {
  override async fetch(request: Request): Promise<Response> {
    return super.fetch(requisicaoDoIsolate(request));
  }
}

/** Extrai texto de .pdf, .xlsx e .xls (containers/extrator). Atende uma extração por vez; o servidor enfileira as demais. */
export class Extrator extends ContainerAtlas {
  defaultPort = 8181;
  sleepAfter = "2m";
}

/** deck-service (Python + python-pptx + LibreOffice): a mesma imagem do docker-compose. */
export class DeckService extends ContainerAtlas {
  defaultPort = 8180;
  sleepAfter = "5m";
}
