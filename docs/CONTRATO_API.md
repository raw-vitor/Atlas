# Contrato entre backend e front (chat persistente)

Fonte única para os agentes. Se precisar mudar algo aqui, relate ao orquestrador em vez de divergir.

## Decisões de arquitetura (complementam o plano, seção 0)

- **Toda mensagem e toda ação vira uma "tarefa".** A rota HTTP valida, grava a mensagem do assessor, pega a trava no DO e enfileira `{tipo: "turno" | "deck" | "purga", ...}` em `atlas-tarefas`. O consumidor da fila executa a lógica que hoje está em `app/api/conversas/[id]/mensagens/route.ts` e `acoes/route.ts`, carregando o caso do DO, publicando eventos no DO e salvando o caso de volta. Um único caminho, com reconexão para tudo.
- **Extração:** `.txt .md .json .csv .vtt .docx .odt .pptx` até 10 MB no Worker (consumidor). `.pdf .xlsx .xls` no Container `Extrator` (Node, reaproveita `lib/ingest.ts`). Imagens repassam bytes ao Bedrock (até 5 MB).
- **Validação JSON:** sem `new Function` em runtime (Ajv standalone gerado no build).

## Bindings (`wrangler.jsonc`)

| Binding | Tipo | Nome |
|---|---|---|
| `DB` | D1 | `atlas-db` |
| `ARQUIVOS` | R2 | `atlas-arquivos` |
| `TAREFAS` | Queue (produtor) | `atlas-tarefas` (DLQ `atlas-tarefas-mortas`) |
| `CONVERSA` | Durable Object (SQLite) | classe `Conversa` |
| `EXTRATOR` | Container (DO) | classe `Extrator` |
| `DECK` | Container (DO) | classe `DeckService` |

Variáveis: `ENVIRONMENT`, `ATLAS_DEV_USUARIO`, `BEDROCK_*`, `ATLAS_CONTEXTO_TOKENS` (opcional), `MAX_UPLOAD_MB`.

## Autenticação

Toda rota `/api/*` chama `usuarioAtual(req)` (`lib/auth.ts`) e recebe `{ id, email }` ou responde 401 `{ erro }`. Local: `ATLAS_DEV_USUARIO`, sobreposto pelo cabeçalho `x-atlas-dev-usuario` fora de produção. Conversa de outro usuário responde **404** (não revela existência).

## Rotas

Erros sempre `{ erro: string }` com mensagem em português pronta para a tela.

| Método e rota | Corpo / query | Resposta |
|---|---|---|
| `GET /api/conversas?cursor=` | | `{ itens: ConversaResumo[], cursor: string \| null }` (30 por página, `atualizada` desc) |
| `POST /api/conversas` | `{ titulo? }` | `201 { conversa: ConversaResumo, caso: CasoPublico }` |
| `GET /api/conversas/{id}` | | `{ conversa: ConversaResumo, caso: CasoPublico, tarefa: TarefaPublica \| null, contexto: Contexto \| null, alertasVistos: Faixa[] }` |
| `PATCH /api/conversas/{id}` | `{ titulo?, alertaVisto?: Faixa }` | `{ conversa: ConversaResumo }` |
| `DELETE /api/conversas/{id}` | | `204`. Some da lista na hora; purga assíncrona |
| `GET /api/conversas/{id}/mensagens?antes={seq}&limite=50` | | `{ itens: MensagemSalva[], maisAntigas: boolean }` (ordem crescente de `seq`) |
| `PUT /api/conversas/{id}/anexos?nome={nome}` | corpo = bytes do arquivo, `Content-Length` obrigatório | `201 { anexo: Anexo }`; `413` tamanho, `415` formato |
| `POST /api/conversas/{id}/mensagens` | `{ texto: string, anexos: string[] /* Anexo.chave */, idCliente: string }` | `202 { mensagem: MensagemSalva, tarefa: TarefaPublica }`; `409` se houver tarefa em andamento |
| `POST /api/conversas/{id}/acoes` | `{ acao: "gerar" }` | `202 { tarefa: TarefaPublica }`; `409`, `422 { erro, faltas }`, `503` |
| `POST /api/conversas/{id}/cancelar` | | `202 { ok: true }` (idempotente) |
| `GET /api/conversas/{id}/eventos` | cabeçalho `Last-Event-ID` opcional | `text/event-stream` (abaixo) |
| `GET /api/conversas/{id}/decks/{versao}?fmt=pptx\|pdf` | | o arquivo, `Content-Disposition: attachment` |

## Tipos

```ts
type Faixa = 60 | 85 | 95;
interface ConversaResumo { id: string; titulo: string; criada: number; atualizada: number; ctxTokens: number; ctxLimite: number }
interface Anexo { chave: string; nome: string; tamanho: number; tipo: string }
interface MensagemSalva {
  id: string; seq: number; idCliente?: string; criada: number;
  tipo: "usuario" | "atlas" | "resultado";
  texto?: string;
  meta?: { anexos?: Anexo[]; erro?: boolean; versao?: number; resultado?: Resultado /* components/chat/types.ts */ };
}
interface TarefaPublica { id: string; tipo: "turno" | "deck"; status: "na_fila" | "rodando" | "concluida" | "cancelada" | "erro"; posicao?: number; iniciada: number }
interface Contexto { tokens: number; limite: number; pct: number; estimado: boolean; partes: { transcricao: number; carteira: number; historico: number; outros: number } }
```

`CasoPublico` continua o de `components/chat/types.ts` (sem `ocupado` como fonte de verdade: use `tarefa`).

## Eventos SSE (`/eventos`)

Cada evento tem `id:` numérico crescente por conversa. O DO guarda os eventos da tarefa atual e da última terminada; com `Last-Event-ID` reenvia os posteriores. Sem tarefa, manda `estado` e fica aberto com `: ping` a cada 25 s.

| `event:` | `data` |
|---|---|
| `estado` | `{ tarefa: TarefaPublica \| null }` (sempre o primeiro) |
| `fila` | `{ posicao: number }` |
| `atividade` | igual ao de hoje (`{ texto, ... }`) |
| `progresso` | `{ etapa, pct, msg }` (geração do deck, como o `Evento` de hoje) |
| `texto` | `{ texto }` resposta parcial/final do Atlas, como hoje |
| `caso` | `CasoPublico` |
| `contexto` | `Contexto` |
| `mensagem` | `MensagemSalva` (a mensagem final gravada em D1: `atlas` ou `resultado`) |
| `fim` | `{ status: TarefaPublica["status"] }` |
| `erro` | `{ mensagem }` |

## Medidor (D4/D5)

`limite` = `lib/modelos.ts` pela `BEDROCK_MODEL_ID` (ou `ATLAS_CONTEXTO_TOKENS`). Faixas: <60 só anel; 60 primeiro alerta discreto; 85 alerta mais forte; 95 faixa fixa. Só aviso. Cada alerta uma vez por conversa; fechar faz `PATCH { alertaVisto }`.

## Donos de arquivos

| Área | Dono |
|---|---|
| `worker.ts`, `workers/**`, `wrangler.jsonc`, `migrations/**`, `lib/cf.ts`, `lib/auth.ts`, `lib/db/**`, `lib/caso.ts`, `lib/tarefas/**`, `app/api/**`, `containers/**` | backend |
| `components/**`, `app/page.tsx`, `app/layout.tsx`, `theme/**` | front |
| `package.json` | só o orquestrador instala dependências; agentes pedem na resposta. Scripts podem ser adicionados pelo agente dono da tarefa |

## Testes

- `@cloudflare/vitest-pool-workers` exige vitest 4 e o projeto usa vitest 5: **não usar**. Testes de integração com D1/R2/DO/fila rodam em Node (vitest 5) contra o runtime local do wrangler (`unstable_startWorker` / `getPlatformProxy` do pacote `wrangler`), em `tests/workers/*.test.ts`, via `npm run test:workers`. `npm test` continua rápido e sem wrangler.
- Já instalados: `@cloudflare/containers`, `@cloudflare/workers-types`. `@aws-sdk/client-bedrock-runtime` foi removido.

## Plataforma: Durable Object, fila e Containers (fase 1)

Implementação em `worker.ts`, `workers/conversa.ts`, `workers/containers.ts`, `lib/cf.ts`, `lib/tarefas/**`. Os testes de comportamento estão em `tests/workers/conversa.test.ts`.

### Acesso ao ambiente

- `env()` de `lib/cf.ts` devolve o `CloudflareEnv` tipado (`cloudflare-env.d.ts`, gerado por `npm run cf-typegen`). Em rota: usa `getCloudflareContext()`. No consumidor da fila e no cron: o `worker.ts` envolve a execução em `comAmbiente(env, ctx, fn)`. Em teste: `env(injetado)`. Nunca chame no nível do módulo.
- `conversaDo(conversaId)` devolve o stub do DO (`CONVERSA.idFromName(conversaId)`). **A rota confere o dono em D1 antes** (`conversas.usuario_id = usuario.id AND apagada IS NULL`); o id da conversa sozinho não dá acesso.

### Fila `atlas-tarefas` (`MensagemTarefa` em `lib/tarefas/tipos.ts`)

```ts
{ tipo: "turno" | "deck"; conversaId; usuarioId; tarefaId }   // tarefaId vem de iniciarTarefa
{ tipo: "purga"; conversaId; usuarioId }
```

O texto do assessor, os anexos e tudo o que o consumidor precisa ficam no `payload` da tarefa dentro do DO (`iniciarTarefa(tipo, payload)`), nunca na fila. Fluxo da rota: confere o dono em D1 → grava a mensagem do assessor → `iniciarTarefa` → se `ok`, `TAREFAS.send(...)` e responde `202`; se `ocupado`, `409`.

A fila entrega **pelo menos uma vez**. O consumidor sempre começa por `comecarTarefa(tarefaId, message.attempts)` e só executa se vier `ok`; qualquer outro resultado (`em_execucao`, `encerrada`, `inexistente`, `purgada`) é ack sem fazer nada. Falha: `retry` com espera crescente (10, 20, 40 s... até 5 min), 3 reentregas, depois `atlas-tarefas-mortas`. Mensagem com corpo inválido também vai para a fila de mortas (nunca é descartada com ack).

### RPC do Durable Object `Conversa` (todos os métodos são assíncronos)

| Método | Resultado |
|---|---|
| `iniciarTarefa(tipo, payload?)` | `{ ok: true, tarefa }` pegou a trava (`na_fila`), tirou o instantâneo do caso. `{ ok: false, ocupado: true, tarefa }` → 409. `{ ok: false, purgada: true }` → 404 |
| `comecarTarefa(tarefaId, tentativa)` | `{ ok: true, tarefa, payload }` ou `{ ok: false, motivo: "inexistente" \| "encerrada" \| "em_execucao" \| "purgada" }` |
| `batimento(tarefaId)` | `{ ativa, cancelada }`. Renova o lease. Chamar a cada poucos segundos durante a tarefa e abortar o `fetch` em andamento se `cancelada`. `ativa: false`: parar sem gravar nada |
| `cancelado(tarefaId?)` | `boolean` (para `checarCancelado()` entre chamadas ao LLM) |
| `cancelar()` | `{ ok, cancelada, cancelando, tarefa }`. Na fila: encerra na hora e restaura o caso. Rodando: grava a marca; o consumidor encerra com `terminarTarefa("cancelada")`. Idempotente |
| `publicar(evento, dados, tarefaId?)` | `id` do evento, ou `null` se foi ignorado (conversa purgada, ou `tarefaId` que não está mais ativa). Evento `contexto` também fica guardado para `estado()` |
| `salvarCaso(caso, { versao?, tarefaId? })` | `{ ok: true, versao }` ou `{ ok: false, motivo: "versao" \| "tarefa" \| "purgada", versao }`. Com `tarefaId`, só grava enquanto a tarefa estiver ativa |
| `obterCaso()` | `{ caso \| null, versao }`. O caso é JSON puro (sem o texto das fontes, que fica em R2) |
| `terminarTarefa(status, { tarefaId?, restaurar?, erro? })` | `{ ok: true, tarefa, jaEncerrada }`. Publica `fim` (e `erro`, se informado) na mesma operação. `restaurar` volta o caso ao instantâneo (padrão: só em `cancelada`). Idempotente |
| `eventosDesde(id, limite?)` | `{ id, evento, dados }[]` |
| `sse(lastEventId?)` | `Response` `text/event-stream` (a rota o devolve como está; repassar o cabeçalho `Last-Event-ID`) |
| `alertaVisto(faixa)` | `Faixa[]` vistas, ou `null` se a faixa não for 60, 85 ou 95 (a rota responde 400) |
| `estado()` | `{ tarefa, contexto, alertasVistos, purgada }` para `GET /api/conversas/{id}` |
| `purgar()` | `{ ok: true }`. Apaga tudo e deixa só a marca `purgada` |

Garantias: uma só tarefa ativa por conversa (dois `iniciarTarefa` simultâneos dão um `ok` e um `ocupado`); tarefa sem batimento por 20 min expira como `erro` e o caso volta ao instantâneo; depois de `purgar()` toda escrita é recusada, então um consumidor atrasado não recria o que foi apagado. Purga completa, ordem recomendada: cancelar → R2 (prefixo `u/{usuarioId}/c/{conversaId}/`) → `purgar()` do DO → linhas de D1; cada passo é idempotente e a linha de D1 com `apagada` é o que mantém a purga pendente até terminar.

### Eventos SSE (comportamento do DO)

`estado` é sempre o primeiro e **não tem `id`** (não altera o `Last-Event-ID`). Sem `Last-Event-ID`: se há tarefa ativa, reenvia os eventos dela desde o início; sem tarefa, só `estado`. Com `Last-Event-ID`: reenvia os guardados com id maior (tarefa atual e última encerrada, no máximo 2000 eventos). `retry: 3000` no início e `: ping` a cada 25 s. O front deve deduplicar `mensagem` por `id`.

### D1 (`migrations/0001_chat.sql`)

Como o plano (seção 4.1), mais: `mensagens.id_cliente`; índice único parcial `(conversa_id, id_cliente) WHERE id_cliente IS NOT NULL` (um reenvio do mesmo POST falha na inserção e a rota deve responder com a mensagem já gravada, não gravar de novo); índice `conversas(apagada, atualizada)` para a purga de 90 dias e as purgas pendentes. Os alertas vistos não estão em D1: ficam no DO.

### Containers

- `EXTRATOR`: `POST /extrair?nome=` com os bytes, resposta `{ texto, truncado }`; `.pdf .xlsx .xls` até `MAX_UPLOAD_MB`; `422 { erro }` quando não extrai; `415` para outro formato. Atende uma extração por vez (o xlsx de 25 MB chega a 1,4 GB). Teto de 2 milhões de caracteres na resposta (`EXTRATOR_MAX_CHARS`). Uso: `env.EXTRATOR.get(env.EXTRATOR.idFromName("pool-0")).fetch(new Request("http://extrator/extrair?nome=...", { method: "POST", body }))`.
- `DECK`: a mesma imagem do docker-compose (porta 8180), instância `standard-1`. Uso igual, com o caminho do deck-service.
- `max_instances` 2 para ambos; só vale em produção (local não limita).

## Ambiente local

| Comando | O que roda | Serve para |
|---|---|---|
| `npm run dev` | `next dev` com `initOpenNextCloudflareForDev()` (`next.config.ts`, só em `NODE_ENV=development`) | UI, rotas que usam **D1 e R2**. O estado fica em `.wrangler/state`, o mesmo do `wrangler dev` |
| `npm run db:migrate:local` | `wrangler d1 migrations apply atlas-db --local` | Criar/atualizar o banco local. Rode antes do primeiro `dev`/`preview` |
| `npm run preview` | `opennextjs-cloudflare build` + `wrangler dev` (workerd real) | **Fluxo completo**: DO, fila, cron e Containers. Exige Docker: a primeira subida constrói as duas imagens (extrator e deck-service, vários minutos); as seguintes usam o cache. Sem Docker, defina `"dev": { "enable_containers": false }` no `wrangler.jsonc` só na sua máquina (não versionar) e a extração de pdf/xlsx e o deck ficam indisponíveis |
| `npm run test:workers` | Vitest em Node + `createTestHarness` do wrangler contra `tests/workers/wrangler.test.jsonc` | Testes de integração com D1, R2, DO e fila no runtime do Worker |
| `npm run cf-typegen` | `wrangler types` | Regera `cloudflare-env.d.ts` depois de mudar `wrangler.jsonc` ou `.dev.vars.example` |

**Decisão para `next dev`: DOs, filas e Containers só existem em `npm run preview`.** O `getPlatformProxy` (que o `next dev` usa) não carrega as classes de DO do mesmo Worker; a solução recomendada pela Cloudflare é um Worker auxiliar com `script_name`, mas a fila continuaria sem consumidor (o produtor do Next e o consumidor do Worker auxiliar ficam em instâncias separadas do Miniflare), então o chat não funcionaria de ponta a ponta mesmo assim. Em `next dev`, `env().DB` e `env().ARQUIVOS` funcionam; `env().TAREFAS.send()` não falha mas ninguém consome; `conversaDo(...)` falha com `internal error` na primeira chamada de RPC. O `wrangler` imprime no início um aviso sobre as classes `Conversa`, `Extrator` e `DeckService`; é esperado.

Testes de rota que precisem do DO ou da fila devem ir em `tests/workers/` (com o entry de teste) ou usar dublês em `tests/` (Vitest comum).
