# Plano: chat persistente do Atlas na Cloudflare

Status: aprovado, em implementação na branch `feat/cloudflare-chat-persistente`.

## 0. Decisões tomadas (valem sobre o resto do documento)

- **D1.** Persistir é permitido. Conversa sem uso há 90 dias é purgada por inteiro (D1, R2 e DO) pelo cron diário, pelo mesmo caminho da exclusão manual (`{tipo: "purga"}`). O R2 também ganha regra de ciclo de vida de 90 dias como rede de segurança.
- **D2.** Por enquanto tudo é local. `lib/auth.ts` devolve `{ id, email }`; localmente vem de `ATLAS_DEV_USUARIO` (padrão `dev@eqi.local`). A validação do JWT do Cloudflare Access fica atrás de uma interface, sem implementação agora. Para testar vários usuários localmente, o cabeçalho `x-atlas-dev-usuario` sobrepõe o usuário só quando `ENVIRONMENT !== "production"`.
- **D3.** Workers com assets estáticos via OpenNext (seção 3). Sem deploy por enquanto.
- **D4.** O limite do medidor vem do modelo em uso: tabela `lib/modelos.ts` com a janela de contexto por `modelId` do Bedrock (o Converse não devolve esse dado), com `ATLAS_CONTEXTO_TOKENS` só como sobreposição opcional. O valor medido é o `usage.inputTokens` real do Bedrock.
- **D5.** Faixas do medidor: abaixo de 60% só o anel; **60%** primeiro alerta (faixa discreta, uma vez); 85% alerta mais forte; 95% faixa fixa. Só aviso, sem o botão "Nova conversa com este caso".
- **D6.** Ignorado por enquanto (sem deploy, só `wrangler dev`/Miniflare).

## 1. Objetivo

1. Cada assessor vê só as suas conversas. Elas sobrevivem a recarregar a página, trocar de máquina e reiniciar o servidor.
2. Botão para apagar conversa, que apaga de fato tudo o que ela guardou (mensagens, arquivos, decks, estado do caso).
3. Medidor da janela de contexto por conversa, com alertas visuais de porcentagem que não atrapalham a conversa.
4. Deploy na Cloudflare: Workers (com assets estáticos), D1, R2, Queues, Durable Objects e Containers. Tudo testável localmente.
5. Vários usuários enviando mensagens e anexos ao mesmo tempo sem derrubar o Bedrock nem o deck-service.

Fora do escopo: mudar prompts, cálculos, layout do deck ou o fluxo de conversa que existe hoje.

## 2. Ponto de partida (o que o código faz hoje)

| Item | Hoje | Por que quebra na Cloudflare ou sem persistência |
|---|---|---|
| Conversas no navegador | `ChatShell.tsx` guarda tudo em `useState`. "As conversas ficam só nesta aba." | Recarregou, perdeu. |
| Caso no servidor | `lib/caso.ts`: `Map` em `globalThis`, TTL de `JOB_TTL_MIN` (60 min). | Workers rodam em vários isolates; um `Map` global não é compartilhado nem durável. |
| Trava por conversa | `caso.ocupado = true` no mesmo objeto em memória. | Dois isolates aceitariam duas mensagens ao mesmo tempo. |
| Jobs do deck | `lib/jobs.ts`: `Map` global, fila de 3 vagas em memória, arquivos em `WORK_DIR` com `fs`. | Sem disco local; a fila em memória não vale entre instâncias. |
| Progresso | SSE da própria requisição (`respostaSSE`) e `EventSource` em `/api/jobs/[id]/events` com ouvintes em memória. | O ouvinte e o job podem estar em isolates diferentes. |
| Base de conhecimento | `lib/knowledge.ts` lê `../conhecimento/*.md` com `fs`. | Sem sistema de arquivos no Worker. |
| Deck | `lib/deck.ts` chama o deck-service Python (python-pptx + LibreOffice `soffice`). | Python + LibreOffice não rodam num Worker. |
| Bedrock | `lib/bedrock.ts`: `fetch` com Bearer, ou o SDK da AWS com credenciais do ambiente. | O caminho com Bearer funciona no Worker. O do SDK depende da cadeia de credenciais da AWS e deve sair. |
| Login | `ATLAS_ACCESS_TOKEN` único, compartilhado. | Não há identidade de usuário, então não dá para separar conversas por assessor. |
| Privacidade | Comentários e README: "nada do lead vai para o disco". | Persistir conversa muda essa regra. Ver decisão D1. |

## 3. Arquitetura proposta

```
Navegador (React/Chakra)
   │  HTTPS (Cloudflare Access na frente: identidade do assessor)
   ▼
Worker "atlas" (Next.js via @opennextjs/cloudflare + assets estáticos)
   │ rotas /api/*
   ├── D1 "atlas-db" ............ usuários, conversas, mensagens (lista lateral e histórico)
   ├── R2 "atlas-arquivos" ...... anexos originais, texto extraído, decks pptx/pdf
   ├── Durable Object Conversa .. 1 instância por conversa: estado do caso, trava, progresso (SSE)
   ├── Queue "atlas-tarefas" .... leitura de anexos e geração do deck, com concorrência limitada
   │      └── consumidor (mesmo Worker): chama Bedrock e o container do deck
   └── Container "deck-service" . a imagem Docker atual do deck-service (Python + LibreOffice)
```

### 3.1 Por que cada peça

- **Workers com assets estáticos, sem Pages.** O pedido cita Pages. Para Next.js com rotas de servidor, a Cloudflare orienta usar Workers com assets estáticos; os assets do Next (`/_next/static`, `public/`) são servidos pela mesma camada estática que o Pages usa, sem cobrar invocação do Worker. Pages só faria sentido se o front virasse export estático e a API fosse um Worker separado, o que dobra o deploy e obriga CORS. Ver decisão D3. Fontes: [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), [OpenNext Cloudflare](https://opennext.js.org/cloudflare).
- **OpenNext em vez de vinext.** A Cloudflare recomenda o vinext para apps Next novos, mas ele está em beta ([guia Next.js](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)). O OpenNext suporta todas as versões do Next 16 e o runtime Node.js, que é o que as rotas usam hoje (`runtime = "nodejs"`, `AsyncLocalStorage`, `Buffer`, `node:crypto`). O spike (fase 0) roda `npx vinext check` também, só para registrar.
- **Durable Object por conversa.** Resolve três problemas de uma vez: uma única instância por id substitui o `Map` global e o `caso.ocupado`; o armazenamento SQLite do DO guarda o caso de forma durável; e o DO é o ponto único onde o progresso é publicado, então o navegador pode reconectar e ver o andamento depois de recarregar a página.
- **D1 para o que é listado e paginado.** A lista lateral ("minhas conversas, mais recentes primeiro") e o histórico de mensagens são consultas por usuário e por conversa com índice. D1 é SQLite, roda local com `wrangler`, e tem migrações versionadas.
- **R2 para binários.** Anexos de até `MAX_UPLOAD_MB` (25 MB) e decks não cabem bem em banco. O upload vai em streaming do corpo da requisição para o R2, sem montar `Buffer` na memória do Worker (limite de 128 MB por isolate, [limites](https://developers.cloudflare.com/workers/platform/limits/)).
- **Queues para picos.** Ler anexos e montar deck são tarefas de dezenas de segundos a minutos, com várias chamadas ao Bedrock. A fila desacopla a requisição do trabalho e limita quantas rodam ao mesmo tempo (`max_concurrency`), o que protege a cota do Bedrock e o container. O consumidor tem até 15 min de CPU por invocação.
- **Containers para o deck-service.** Roda a mesma imagem de `deck-service/Dockerfile`, controlada por um DO. Não exige reescrever python-pptx nem trocar o LibreOffice. `wrangler dev` sobe o container localmente com Docker ([local dev](https://developers.cloudflare.com/containers/local-dev)).

### 3.2 O que fica igual

Prompts, `calc.ts`, `validate.ts`, `steps.ts`, `pipeline.ts`, schemas e o contrato com o deck-service. A troca é de onde o estado mora e de quem executa o trabalho longo.

## 4. Modelo de dados

### 4.1 D1 (migração `0001_chat.sql`)

```sql
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,            -- "sub" do JWT do Cloudflare Access
  email TEXT NOT NULL UNIQUE,
  criado INTEGER NOT NULL
);

CREATE TABLE conversas (
  id TEXT PRIMARY KEY,            -- 32 hex, mesmo formato de hoje
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  criada INTEGER NOT NULL,
  atualizada INTEGER NOT NULL,
  ctx_tokens INTEGER NOT NULL DEFAULT 0,   -- último valor do medidor (para a lista não abrir o DO)
  ctx_limite INTEGER NOT NULL,
  apagada INTEGER                           -- marca de exclusão; a limpeza roda pela fila
);
CREATE INDEX conversas_usuario ON conversas(usuario_id, apagada, atualizada DESC);

CREATE TABLE mensagens (
  conversa_id TEXT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                     -- ordem dentro da conversa, dada pelo DO
  id TEXT NOT NULL,
  tipo TEXT NOT NULL,                       -- usuario | atlas | resultado
  texto TEXT,
  meta TEXT,                                -- JSON: anexos, erro, jobId, resumo do deck, tokens
  criada INTEGER NOT NULL,
  PRIMARY KEY (conversa_id, seq)
) WITHOUT ROWID;
```

- Mensagens de progresso não são gravadas. Só a mensagem final de cada etapa.
- Toda consulta filtra por `usuario_id` vindo do JWT, nunca do corpo da requisição.

### 4.2 Durable Object `Conversa` (SQLite do DO)

- `caso`: o objeto `Caso` atual sem o texto das fontes (lead, ativos, análise, rascunho, edições, decks, histórico).
- `fontes`: uma linha por fonte com metadados; o texto extraído fica em R2 (`.../fontes/{hash}.txt`) porque uma transcrição pode chegar a 200 mil caracteres.
- `eventos`: últimos eventos de progresso da tarefa em andamento, para quem reconectar.
- `tarefa`: id, tipo, status, `AbortController` lógico (flag de cancelamento lida entre etapas).

### 4.3 R2

```
u/{usuarioId}/c/{conversaId}/anexos/{hash}-{nome}
u/{usuarioId}/c/{conversaId}/fontes/{hash}.txt
u/{usuarioId}/c/{conversaId}/decks/v{n}.pptx | v{n}.pdf
```

O prefixo por usuário e conversa permite apagar tudo de uma conversa listando o prefixo. Download passa por uma rota do Worker que confere o dono antes de ler o objeto; o bucket não é público.

## 5. Fluxos

### 5.1 Enviar mensagem com anexos

1. O navegador envia cada arquivo para `PUT /api/conversas/{id}/anexos`. O Worker confere tamanho e extensão (as mesmas regras de `lib/formatos.ts`) e faz `R2.put` com o corpo em streaming. Vários anexos sobem em paralelo, até 3 por vez, com barra por arquivo no chip.
2. `POST /api/conversas/{id}/mensagens` com o texto e as chaves R2. O Worker repassa ao DO da conversa.
3. O DO recusa com 409 se houver tarefa em andamento (o mesmo comportamento de hoje), grava a mensagem do assessor em D1 e:
   - pedido curto sem anexo (instrução ou pergunta): resolve na hora, dentro do DO, como faz hoje;
   - com anexo: põe `{tipo: "leitura", conversaId}` na fila e devolve `202`.
4. O navegador abre `GET /api/conversas/{id}/eventos` (SSE servido pelo DO). Recebe `atividade`, `texto`, `caso`, `contexto` e `fim`, os mesmos eventos de hoje mais `contexto`.
5. O consumidor da fila lê os anexos do R2, extrai o texto (`lib/ingest.ts`), chama o Bedrock e publica o progresso no DO. Ao terminar, o DO grava a resposta em D1.

Se a página recarregar no meio, o navegador reabre o SSE com `Last-Event-ID` e o DO reenvia os eventos guardados.

### 5.2 Gerar slides

Igual a 5.1, com `{tipo: "deck"}` na fila. O consumidor monta o payload, chama o container do deck-service e grava `v{n}.pptx` e `v{n}.pdf` em R2. O card de resultado vira uma mensagem `resultado` em D1, com links para `/api/conversas/{id}/decks/{n}?fmt=pptx`.

### 5.3 Cancelar

`POST /api/conversas/{id}/cancelar` marca a tarefa como cancelada no DO. O consumidor confere a marca entre chamadas ao LLM (o ponto onde `checarCancelado()` já é chamado hoje). O DO restaura a cópia do caso tirada antes da tarefa (`copiarCaso`/`restaurarCaso`) e apaga de D1 a mensagem do assessor, mantendo o comportamento atual: "Cancelado. Nada foi alterado na conversa."

### 5.4 Apagar conversa

1. Item da lista lateral ganha um menu (ícone de três pontos, visível no hover e sempre visível no toque) com "Apagar conversa".
2. Diálogo de confirmação: "Apagar a conversa e os arquivos dela? Não dá para desfazer." Botões "Cancelar" e "Apagar".
3. `DELETE /api/conversas/{id}`: confere o dono, cancela a tarefa em andamento, marca `apagada` em D1 e põe `{tipo: "purga"}` na fila. A conversa some da lista na hora.
4. O consumidor apaga os objetos do prefixo no R2, chama `deleteAll()` no storage do DO e apaga as linhas em D1. É idempotente; se falhar, vai para a fila de mensagens mortas e um cron diário refaz as purgas pendentes.

### 5.5 Abrir o app e trocar de conversa

- `GET /api/conversas?cursor=` devolve 30 itens (id, título, `atualizada`, `ctx_tokens`, `ctx_limite`) pelo índice `conversas_usuario`.
- `GET /api/conversas/{id}/mensagens?antes={seq}&limite=50` devolve as últimas 50; rolar para cima carrega as anteriores.
- `GET /api/conversas/{id}` devolve o `CasoPublico` do DO.
- O navegador guarda em memória as conversas já abertas na sessão; trocar de volta não refaz a busca.

## 6. Desempenho

| Ponto | Medida |
|---|---|
| Lista lateral | Uma consulta indexada em D1, só colunas leves, paginada. Meta: p95 abaixo de 150 ms. |
| Abrir conversa | Mensagens e caso buscados em paralelo; 50 mensagens por página. Meta: p95 abaixo de 300 ms. |
| Envio | Mensagem do assessor aparece na hora (otimista); a confirmação do servidor só troca o id. |
| Escrita | Só mensagens finais vão para D1. Progresso fica no DO e não toca o banco. |
| Leituras | D1 Sessions API para ler de réplicas quando houver; a escrita sempre na primária. |
| Memória do Worker | Upload em streaming para R2. A extração de texto roda no consumidor, um anexo por vez, com o limite de 25 MB por arquivo mantido. |
| Pico de usuários | `max_concurrency` da fila (começa em 5) e `max_batch_size = 1`. Quem chega com a fila cheia vê "Na fila, posição N" no progresso. |
| Bedrock | Os retries com espera já existem em `criarChatJson`; a concorrência da fila é o limite de chamadas simultâneas. |
| Container | Uma instância por vez por padrão, com `max_instances` ajustável. O deck já é sequencial por caso. |
| Bundle | Remover `@aws-sdk/client-bedrock-runtime` (o caminho com Bearer usa `fetch`). Medir o tamanho comprimido do Worker no spike. |

Lista virtualizada de mensagens só entra se uma conversa passar de algumas centenas de mensagens. Hoje um caso típico tem dezenas.

## 7. Medidor da janela de contexto

### 7.1 O que ele mede

O Atlas não manda a conversa inteira ao modelo. Cada chamada monta um prompt com o caso: dados do lead, carteira, rascunho, avisos, trechos da transcrição e as últimas 10 mensagens (`lib/conversa.ts`, `MAX_HISTORICO_PROMPT`). O que cresce com a conversa é esse prompt.

- **Valor medido:** o maior `usage.inputTokens` devolvido pelo Bedrock nas chamadas da última mensagem que usam o caso (`responderPergunta`, `interpretarInstrucao`, extração do lead). É o número real, sem estimativa.
- **Antes da primeira chamada:** estimativa de caracteres ÷ 3,5 sobre o texto extraído dos anexos, marcada como "estimado" no tooltip.
- **Limite:** `ATLAS_CONTEXTO_TOKENS`, configurável. O Sonnet 4.6 no Bedrock aceita até 1 milhão de tokens ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html)), mas os cortes atuais do Atlas (transcrição com até 200 mil caracteres, 10 mensagens de histórico) deixam o prompt muito abaixo disso. Com 1 milhão como limite, o medidor ficaria parado perto de 5% e não ajudaria. Proposta: 200 mil tokens como orçamento por conversa, para custo e tempo de resposta. Ver decisão D4.
- O DO envia o evento `contexto` com `{ tokens, limite, estimado, partes: { transcricao, carteira, historico, outros } }` a cada mensagem, e grava `ctx_tokens` em D1 para a lista.

### 7.2 Faixas

| Faixa | Visual | Comportamento |
|---|---|---|
| 0–69% | Anel de 16 px em `nevoa`, preenchimento em `eqi`. Sem número. | Tooltip no hover: "Contexto: 38% (76 mil de 200 mil tokens)" e a divisão por parte. |
| 70–84% | Anel em âmbar suave, número "72%" ao lado em `xs`. | Nada mais. |
| 85–94% | Anel em laranja. | Uma faixa fina acima do composer, uma vez por conversa: "A conversa está ficando longa (87%). As respostas podem demorar mais." Botão "Entendi". |
| 95% ou mais | Anel em vermelho `red.600`. | Faixa fixa acima do composer: "Contexto quase cheio (96%). Para não perder detalhes, comece uma nova conversa com este caso." Botão "Nova conversa com este caso" (ver decisão D5) e "Fechar". |

### 7.3 Regras de UX

- O anel fica no canto direito do composer, ao lado do botão de enviar, onde o olho já está ao escrever. Na lista lateral, só conversas acima de 85% mostram um ponto colorido.
- A faixa de alerta reserva altura com transição de opacidade, sem empurrar a lista de mensagens nem roubar o foco do campo de texto.
- Cada alerta aparece uma vez por faixa, ao cruzá-la. Fechar grava no DO, então não volta ao recarregar.
- Nada de modal, toast que cobre mensagens ou som.
- `aria-live="polite"` só na faixa de alerta; o anel tem `aria-label` com a porcentagem.
- Novas cores entram como tokens semânticos em `theme/system.ts` (`contexto.ok`, `contexto.atencao`, `contexto.alerta`, `contexto.critico`), em tons compatíveis com a paleta EQI do `10_padrao_visual_eqi.md`. Usa `ProgressCircle` e `Tooltip` do Chakra que o projeto já tem.

## 8. Identidade e acesso

- Proposta: Cloudflare Access na frente do Worker, com o provedor de identidade da EQI. O Worker valida o JWT `Cf-Access-Jwt-Assertion` (assinatura e `aud`) em toda rota `/api` e usa o `sub` como `usuario_id`. Ver decisão D2.
- `lib/auth.ts` passa a devolver o usuário em vez de booleano. `ATLAS_ACCESS_TOKEN` sai.
- Local: com `ATLAS_DEV_USUARIO=dev@eqi.local` em `.dev.vars`, o Worker aceita esse usuário sem JWT. Essa variável é ignorada quando `ENVIRONMENT=production`.
- Toda rota de conversa confere `conversas.usuario_id = usuario.id` antes de chamar o DO. O id da conversa sozinho não dá acesso.

## 9. Ambiente local

| Comando | O que sobe | Para quê |
|---|---|---|
| `npm run dev` | `next dev` com `initOpenNextCloudflareForDev()`: D1, R2 e DO locais via Miniflare. | Ciclo rápido de UI e rotas. |
| `npm run preview` | `opennextjs-cloudflare build` + `wrangler dev`: runtime real do Worker com Queues, DO e Container (Docker). | Testar fila, cancelamento, purga e deck de ponta a ponta. |
| `npm run db:migrate:local` | `wrangler d1 migrations apply atlas-db --local` | Criar e evoluir o banco local em `.wrangler/state`. |
| `npm test` | Vitest atual + `@cloudflare/vitest-pool-workers` para DO, D1 e fila. | Testes de integração no runtime do Worker. |

`scripts/dev.mjs` continua conferindo pré-requisitos e passa a checar Docker e `wrangler`. Segredos locais vão para `.dev.vars` (no `.gitignore`); em produção, `wrangler secret put BEDROCK_API_KEY`.

## 10. Fases

Cada fase termina com o app funcionando e testes passando.

### Fase 0: spike de compatibilidade (2 a 3 dias)

- Adicionar `@opennextjs/cloudflare` e `wrangler`, gerar `wrangler.jsonc` com `nodejs_compat`.
- Rodar no `wrangler dev`: `lib/ingest.ts` com os fixtures de `tests/fixtures` (docx via mammoth, pdf via unpdf, xlsx, pptx via jszip), `AsyncLocalStorage` do cancelamento e uma chamada ao Bedrock por `fetch`.
- Medir tamanho comprimido do Worker e memória com um PDF e uma planilha de 25 MB.
- Subir o deck-service como Container local e gerar um deck com `tests/deck.integration.test.ts`.
- **Saída:** relatório curto com o que funcionou. Se a extração estourar memória, ela vai para o Container junto com o deck.

### Fase 1: base Cloudflare

- `wrangler.jsonc` com bindings D1, R2, Queue (produtor, consumidor e fila morta), DO `Conversa`, Container `DeckService`, cron diário.
- `lib/knowledge.ts`: os `.md` de `conhecimento/` entram no bundle por um script de build que gera `lib/knowledge.gerado.ts`. Sem `fs`.
- `lib/config.ts` lê de `getCloudflareContext().env`. Remove o caminho do SDK da AWS em `lib/bedrock.ts`.
- `lib/deck.ts`: `renderizar` devolve o `ArrayBuffer` em vez de escrever arquivo; quem chama grava no R2.

### Fase 2: identidade e persistência

- Migração D1, validação do JWT do Access, `usuarios` criado no primeiro acesso.
- DO `Conversa` com o estado do caso. `obterCaso`/`novoCaso`/`tocar` passam a falar com o DO. `caso.ocupado` vira a trava do DO.
- Rotas novas: `GET /api/conversas`, `GET /api/conversas/{id}/mensagens`, `DELETE /api/conversas/{id}`.
- Testes: um usuário não lê nem apaga conversa de outro; duas mensagens simultâneas na mesma conversa resultam em uma aceita e um 409.

### Fase 3: anexos e fila

- `PUT /api/conversas/{id}/anexos` com streaming para R2.
- Consumidor `leitura`: extrai, guarda o texto em R2, roda `leitura()`/`interpretar()` e publica no DO.
- SSE servido pelo DO com `Last-Event-ID`.
- Teste de carga local: 20 conversas enviando 2 anexos ao mesmo tempo. Nenhuma falha; a fila respeita a concorrência.

### Fase 4: deck

- Consumidor `deck` chama o Container e grava em R2.
- `GET /api/conversas/{id}/decks/{n}` substitui `/api/jobs/{id}/download`. As rotas `/api/jobs/*` e `lib/jobs.ts` saem.

### Fase 5: front persistente

- `ChatShell.tsx`: lista lateral vinda do servidor com paginação, mensagens com "carregar anteriores", reconexão do progresso ao abrir uma conversa com tarefa em andamento.
- Menu "Apagar conversa" com diálogo de confirmação.
- Remover o texto "As conversas ficam só nesta aba."

### Fase 6: medidor de contexto

- `Uso` ganha `maiorEntrada`; as chamadas que usam o caso a atualizam.
- Evento `contexto` e coluna `ctx_tokens`.
- Componente `ContextoMedidor` (anel + tooltip) e `ContextoAlerta` (faixa), com tokens de cor no tema.
- Testes: as faixas mudam em 70, 85 e 95%; o alerta fechado não volta após recarregar.

### Fase 7: produção

- Ambientes `staging` e `production` no `wrangler.jsonc`, com bancos e buckets separados.
- Regra de ciclo de vida no R2 conforme a retenção decidida em D1.
- Workers Logs e alertas para fila morta e erros do Container. Logs sem conteúdo do lead (a regra atual do `console.error` continua).
- Teste de carga em staging com o número de assessores esperado.

## 11. Riscos

| Risco | Mitigação |
|---|---|
| mammoth, unpdf ou xlsx falham ou estouram 128 MB no Worker | Fase 0 testa. Plano B: extração no Container. |
| Container demora para iniciar (partida a frio) | Manter uma instância aquecida em horário comercial ou aceitar alguns segundos a mais na primeira geração do dia. |
| D1 tem um único ponto de escrita por banco | O volume do Atlas (assessores internos, dezenas de mensagens por caso) fica muito abaixo do limite. Se crescer, as mensagens podem ir para o SQLite do próprio DO, deixando só a lista em D1. |
| OpenNext não suportar algo do Next 16.4 | O projeto usa só App Router e route handlers. Fase 0 confirma. |
| Dados do lead persistidos (CPF, posição, falas) | Decisão D1, criptografia em repouso da Cloudflare, purga real ao apagar, retenção com ciclo de vida. |

## 12. Decisões que preciso de você

- **D1. Persistir dados do lead.** Hoje a regra é não gravar nada. Persistir exige aval de compliance/LGPD e um prazo de retenção (sugestão: 90 dias sem uso, depois purga automática).
- **D2. Identidade.** Cloudflare Access com o IdP da EQI (Google, Microsoft Entra ou outro)? Sem identidade por usuário não há "minhas conversas".
- **D3. Pages ou Workers.** Recomendo Workers com assets estáticos (um deploy, sem CORS). Se Pages for exigência, o front vira export estático no Pages e a API um Worker separado.
- **D4. Limite do medidor.** 200 mil tokens como orçamento, ou o limite do modelo (1 milhão)?
- **D5. Ação a 95%.** "Nova conversa com este caso" copia o caso (fontes, lead, carteira) e começa o histórico do zero. Alternativa mais simples: só o aviso, sem ação.
- **D6. Plano Cloudflare.** Durable Objects com SQLite, Containers, CPU de 5 min e Queues em produção pedem o Workers Paid. A conta da EQI já tem?
