# Teste de ponta a ponta local (fases 2 a 6)

Executado no runtime real (`npm run preview`: workerd, D1, R2, DO, fila, Containers em Docker) com o Bedrock real. Branch `feat/cloudflare-chat-persistente`.

## Como repetir

1. Pré-requisitos: Docker ativo; `.dev.vars` copiado de `.dev.vars.example` com `BEDROCK_API_KEY`, `BEDROCK_REGION` e `BEDROCK_MODEL_ID` (está no `.gitignore`).
2. `npm run db:migrate:local`, depois `npm run preview` (porta 8788 neste ambiente; o wrangler imprime `Ready on ...`). A primeira subida constrói as imagens do extrator e do deck-service (`containers/extrator`, `containers/deck`).
3. Dois usuários pelo cabeçalho `x-atlas-dev-usuario`: `ana@eqi.local` e `bruno@eqi.local`. Fixtures: `tests/fixtures/transcricao_elisandro.txt`, `carteira_elisandro.csv`, `spike/.fixtures/pequeno.pdf`.
4. Roteiro (curl, `B=http://localhost:8788`):
   1. `POST /api/conversas`; `PUT /anexos?nome=` (`--data-binary @arquivo`) para os dois arquivos; `POST /mensagens {texto, anexos:[chaves], idCliente}`; ler `GET /eventos` até `fim`.
   2. `POST /mensagens` com uma pergunta; abrir `/eventos`, derrubar a conexão após 2 eventos, reabrir com `Last-Event-ID`.
   3. `GET /api/conversas`; `GET /mensagens?limite=1`; `GET /mensagens?limite=2&antes={seq}`.
   4. `POST /acoes {"acao":"gerar"}`; acompanhar `/eventos`; `GET /decks/1?fmt=pptx` e `fmt=pdf`.
   5. Enviar `pequeno.pdf` (passa pelo Container `Extrator`).
   6. Enviar mensagem com anexo e `POST /cancelar` 2 s depois. Comparar `GET /api/conversas/{id}` e `GET /mensagens` antes e depois.
   7. Quatro `POST /mensagens` ao mesmo tempo na mesma conversa.
   8. Com Bruno: todas as rotas da conversa da Ana, e uma mensagem dele citando um anexo da Ana.
   9. `DELETE` da Ana; conferir R2, D1 e DO (abaixo).
   10. `npx wrangler d1 execute atlas-db --local --command "UPDATE conversas SET atualizada = (strftime('%s','now')*1000) - 91*86400000 WHERE id='...'"`; `curl "http://localhost:8788/cdn-cgi/handler/scheduled?cron=0+6+*+*+*"`.
   11. `GET /` e `GET /?c={id}`.
5. Conferir o estado local sem o wrangler: R2 em `.wrangler/state/v3/r2/miniflare-R2BucketObject/*.sqlite` (tabela `_mf_objects`, chave `u/{usuario}/c/{conversa}/...`), D1 em `.wrangler/state/v3/d1/...` (`conversas`, `mensagens`) e o DO em `.wrangler/state/v3/do/atlas-Conversa/*.sqlite` (depois da purga só resta `meta.purgada`). Abrir em modo somente leitura.
6. Logs: o wrangler mostra `console.log` no terminal, mas **não mostra `console.error`** dos Workers (o `[tarefa] falhou` e afins). Eles ficam em `.wrangler/state/v3/observability/miniflare-wobs-trace-store/*.sqlite-wal` (ler com Python, não com `strings`, por causa dos acentos).

## Resultado

| Etapa | Resultado | Tempo |
|---|---|---|
| 1. Conversa, 2 anexos, mensagem, SSE | OK. Eventos: `estado`, `contexto` (estimado), 3 `atividade`, `texto`, `caso` (lead Elisandro, carteira R$ 739.668,62), `contexto` (26.014 tokens, `estimado:false`, limite 1.000.000 de `lib/modelos.ts`), `mensagem`, `fim concluida`. Título automático ok | uploads 31 a 36 ms, POST 103 ms, turno 15 s |
| 2. Reconexão | OK. Derrubado no id 18 e reaberto com `Last-Event-ID: 18`: ids 19 a 23, sem perda nem repetição. Com tarefa já encerrada, reabrir sem cabeçalho devolve só `estado` | pergunta 6 s |
| 3. Lista e paginação | OK. `ctxTokens` na lista. `limite=1` devolve a última com `maisAntigas:true`; `antes=6&limite=2` devolve 4 e 5; `antes=0` e cursor ruim dão 400 | 17 a 20 ms |
| 4. Deck | OK (depois de 2 correções). `progresso` 21, 41, 61, 77, 88, 100, `caso`, `contexto`, `mensagem resultado`, `fim`. pptx 1.247.900 B (Office Open XML), pdf 1.055.293 B (24 páginas), `Content-Disposition` e `no-store` corretos | 96,5 s (LLM 91 s, deck 5 s) |
| 5. PDF no Extrator | OK (depois da correção 1). `pequeno.pdf` virou transcrição R1 e o caso foi preenchido | 10 s com partida a frio do Container |
| 6. Cancelamento | OK. `fim cancelada`; `GET /mensagens` idêntico ao de antes (mensagem do assessor apagada); caso e medidor idênticos (depois da correção 4). Também com deck rodando: o caso volta e não há mensagem `resultado` | ~3 s até o `fim` |
| 7. Concorrência | OK. 4 POST simultâneos: 1 × 202 e 3 × 409 com `tarefa`; nenhuma mensagem órfã | |
| 8. Isolamento | OK. Bruno: lista vazia; 11 rotas da conversa da Ana respondem 404; anexo da Ana na mensagem dele: 400, sem trava presa; cabeçalho inválido: 401 | |
| 9. DELETE | OK. 204, some da lista e GET dá 404 na hora. Em menos de 1 s: R2 8 → 0 objetos, D1 sem conversa nem mensagens, DO só com `purgada`. Apagar no meio de um turno também purga tudo, sem recriar objeto | < 1 s |
| 10. Cron | OK. Conversa com 91 dias e conversa com `apagada` há 2 h (purga pendente) foram purgadas; R2, D1 e DO limpos | < 2 s |
| 11. Página | OK. `/`, `/?c={id}`, `/?c=naoexiste` e `/?c=../../x` respondem 200; assets e favicon 200 | 30 a 200 ms |
| Extra: reinício | OK. Depois de parar e subir o preview, `GET /api/conversas/{id}` e as mensagens são idênticos byte a byte | |
| Extra: 8 conversas ao mesmo tempo (2 anexos cada) | 8 de 8 concluídas, caso correto em todas, purga das 8 limpa. Terminaram a cada ~13 s: o Miniflare entrega a fila em série (ver pendências) | 119 s |

## Defeitos encontrados e corrigidos

1. **Containers inalcançáveis (extrator e deck).** O OpenNext troca `globalThis.Request` por uma subclasse no isolate; o `Request` nativo que chega por RPC ao DO deixa de ser `instanceof Request` e `@cloudflare/containers` o trata como URL (`Invalid URL: [object Request]`). Efeito: PDF e planilha caíam em "Não usei", e gerar slides dava 503. Correção: `lib/requisicao.ts` (`requisicaoDoIsolate`) e uma base `ContainerAtlas` em `workers/containers.ts` que refaz o pedido. Teste: `tests/requisicao.test.ts`. Os testes de workers usavam dublês dos Containers, por isso não pegavam.
2. **Imagem do deck-service não sobe.** `../deck-service/Dockerfile` não copia `app/calc.py` nem `app/config.py`, que `app/deck/build.py` importa (`ImportError`, o container reiniciava em loop e o `/health` dava 500). Correção: `containers/deck/Dockerfile` (cópia com os dois arquivos) e `wrangler.jsonc` apontando para ele. Conferido com `docker build` e `GET /health` (`ok`, `soffice:true`, `schema_hash`).
3. **Frase "Não usei: ..." duplicada** quando todos os anexos falham numa conversa vazia (`lib/chat.ts` já a coloca na pergunta e `logica-turno.ts` a repetia). Teste em `tests/turno.anexos.test.ts`.
4. **Medidor não voltava ao cancelar.** A estimativa publicada no início do turno ficava como `contexto` do DO depois do cancelamento (ou da expiração), embora o caso fosse restaurado. Correção em `workers/conversa.ts`: o instantâneo guarda também `contexto_antes`. Teste em `tests/workers/conversa.test.ts`.
5. **Log de falha sem causa.** `LLMError` não define `name`, então todo erro do modelo aparecia como `"Error"`. `classeDoErro` (`lib/tarefas/execucao/erros.ts`) registra `LLMError HTTP 429` (só o código, nunca a mensagem). Teste em `tests/medidor.test.ts`. Foi o que mostrou que a falha de uma planilha de 5 MB era cota do Bedrock.

Também: `.dev.vars.example` perdeu `WORK_DIR` e `JOB_TTL_MIN`, ganhou `ATLAS_BATIMENTO_MS` e `ATLAS_TAREFAS_POR_ISOLATE` (comentadas) e `KNOWLEDGE_DIR` ficou só como variável de build, comentada.

## Pendências

- `../deck-service/Dockerfile` (fora deste repositório) continua sem `calc.py` e `config.py`; o docker-compose que o usa tem o mesmo problema. Aplicar a mesma linha de `containers/deck/Dockerfile`.
- Localmente a fila é serial (o Miniflare ignora `max_concurrency`), então não foi possível ver 5 turnos em paralelo nem o evento `fila` com posição. O semáforo por isolate e a concorrência da fila em produção só têm teste unitário. Quem espera na própria fila (mais de `max_concurrency`) vê `na_fila` sem posição.
- Planilha de 5 MB sintética (28 MB de XML) chega ao Bedrock com até 2 milhões de caracteres e recebe 429 ("Too many tokens"); o assessor vê a mensagem genérica do modelo. Não há corte do texto antes da triagem por LLM. Decisão de produto: limitar o texto por arquivo ou avisar melhor.
- Os fixtures `spike/.fixtures/grande-25mb*` têm 26,2 MB e a rota os recusa com 413/400 ("passa de 25 MB"), como deve. O caminho de 25 MB no Extrator não foi exercitado de ponta a ponta.
- Cancelar um turno apaga a mensagem do assessor, mas `conversas.atualizada` continua com a hora do envio (a conversa sobe na lista). Não afeta caso, mensagens nem medidor.
- `PUT /anexos` com `Transfer-Encoding: chunked` e sem `Content-Length` foi aceito (201) no wrangler dev; o contrato prevê 411. O proxy local provavelmente já calcula o tamanho. Conferir em staging.
- Se o preview cair no meio de uma tarefa, a fila local (em memória) perde a mensagem e a tarefa só expira pelo lease de 20 min. Em produção a fila é durável.
- Não testado: interface no navegador (só `GET /` e as rotas), alertas do medidor nas faixas 60, 85 e 95 % (exigem contexto grande; cobertos por `tests/medidor.test.ts`), JWT do Access (sem implementação, por decisão D2).
