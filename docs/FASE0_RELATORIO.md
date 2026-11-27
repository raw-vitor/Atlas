# Fase 0: relatório do spike de compatibilidade com Workers

Data: execução local (`wrangler dev`, workerd via Miniflare), Node 22, sem deploy e sem recursos remotos.
Código do spike: `spike/` (Worker descartável, `src/index.ts`; `medir.mjs` mede; `gerar-fixtures.mjs` gera fixtures sintéticos; `baseline-node.mts` é a referência em Node). Resultados brutos em `spike/resultados/*.jsonl` (ignorado pelo git).

## Resultado por item

| Item | Funcionou? | Medida / observação |
|---|---|---|
| Extração de .txt, .vtt, .odt, .pptx pequenos | Sim | 16 a 40 ms; mesmo texto que em Node |
| Extração de .pdf (unpdf) pequeno | Sim | ~100 ms |
| Extração de .xlsx (xlsx) pequeno | Sim | ~30 ms |
| Extração de .docx (mammoth) | **Sim, após correção** | Falhava com `Could not find file in options`. Causa e correção abaixo. Pequeno: 81 ms, +17 MB de RSS. 25 MB: 232 ms, +71 MB (o peso é mídia, que o `extractRawText` ignora) |
| Extração de imagem (`transcreverImagem`) | Não testado | Usa o mesmo `fetch` do Bedrock (item abaixo); só a chamada com imagem ficou sem medir |
| `AsyncLocalStorage` (`lib/cancelamento.ts`) | Sim | `/cancelamento`: sinal visível após `await` e timers; abortar durante `esperar()` gera `CanceladoError`; dois fluxos concorrentes não se misturam; `checarCancelado` lança com sinal abortado |
| Cancelamento de `fetch` em andamento | Sim | Bedrock abortado 150 ms depois do início vira `CanceladoError` |
| Bedrock por `fetch` com Bearer | Sim | `us.anthropic.claude-sonnet-4-6`, `us-east-2`, auth `api-key`. Chave lida de `spike/.dev.vars` (copiada do `.env`, não impressa). Chamada mínima com JSON schema: ~1,2 a 1,9 s |
| `usage.inputTokens` do Converse | Sim | Chamada mínima devolveu `entrada: 167`, `saida: 8` (via `Uso` de `lib/bedrock.ts`). Confirma que D4 pode usar o valor real |
| Ajv (`lib/schemas.ts`, `validar`) | **Não** | `EvalError: Code generation from strings disallowed for this context`. Ajv compila schemas com `new Function`, que o Workers proíbe. Ver impactos |
| Memória real do isolate (128 MB) | **Não verificável localmente** | `process.memoryUsage()` devolve zeros no workerd e o `wrangler dev` não aplica o limite de 128 MB. Nenhum arquivo gerou erro de memória nem reinício do workerd, mas isso não prova que caberia em produção. A tabela de memória usa o RSS do workerd como indicador |
| Deck-service: endereço | Registrado | `DECK_SERVICE_URL`, padrão `http://127.0.0.1:8180` (`lib/config.ts:13`). `scripts/dev.mjs` sobe `deck-service/run.sh` (uvicorn, venv em `../.venv`) ou reaproveita um serviço já no ar. Nada respondia na 8180 na hora do teste |
| Deck-service: Dockerfile | Existe | `../deck-service/Dockerfile` (python:3.12-slim + `libreoffice-impress`, porta 8180). **O contexto de build é o diretório pai de `atlas/`** (`COPY app/...`, `COPY deck-service ...`; ver `../docker-compose.yml`) |
| Docker local | Sim | `docker info` responde: Engine 29.7.2, 31 GiB de RAM. Container local do wrangler é viável |

## Memória e tempo, arquivos de ~25 MB (um `wrangler dev` novo por arquivo, timeout de 120 s)

Linha de base do workerd com o Worker aquecido: ~161 MB de RSS. "Delta" é o pico menos a base. Em nenhum caso houve erro de memória, reinício do workerd ou mensagem no log do wrangler (por isso, a coluna "estourou" só diz que o ambiente local não reclamou).

| Arquivo | Tamanho | Tempo | Texto extraído | Delta de RSS | Referência em Node (RSS pico) |
|---|---|---|---|---|---|
| xlsx (10 colunas, linhas sintéticas) | 25 MB | 15,8 s | 37,0 M caracteres | **+938 MB** | 1.373 MB, 15,5 s |
| pdf com texto | 26,8 MB | 9,7 s | 23,3 M caracteres | **+404 MB** | 576 MB, 14,8 s |
| pdf com imagem grande e 3 páginas de texto | 25 MB | 0,3 s | 10 mil caracteres | +69 MB | |
| docx (texto pequeno + 25 MB de mídia) | 25 MB | 0,2 s | 58 mil caracteres | +71 MB | |
| pptx (texto pequeno + 25 MB de mídia) | 25 MB | 0,15 s | 59 mil caracteres | +57 MB | |
| xlsx | 5 MB | 2,3 s | 7,4 M caracteres | +225 MB | |
| pdf com texto | 5,3 MB | 1,4 s | 4,6 M caracteres | +152 MB | |

Leitura: xlsx e pdf com muito texto usam várias vezes o tamanho do arquivo. O corpo da requisição (25 MB) mais o texto em UTF-16 (23 a 37 M caracteres = 46 a 74 MB) já passam de metade do limite de 128 MB antes de contar os objetos internos do parser. Um xlsx de 5 MB já usa mais RSS (+225 MB) que o limite inteiro do isolate. Esses números não são o heap do isolate, mas o aviso é suficiente: xlsx e pdf grandes não cabem no Worker.
docx e pptx de 25 MB são baratos aqui porque o peso do arquivo é mídia binária. Um docx ou pptx com 25 MB de XML de texto não foi testado.

As medições de `medicao-1795759930419.jsonl` (base 94 MB, processo workerd de proxy) e `medicao-1795759997286.jsonl` (base 0, workerd já encerrado) têm RSS inválido; só os tempos valem. As de RSS válido têm base ~161 MB (`medicao-1795760033764.jsonl` e posteriores).

## Correção do docx (`lib/ingest.ts`, função `docx`)

- **Causa:** o bundler do Worker usa o campo `browser` de `mammoth/package.json`, que troca `lib/unzip.js` por `browser/unzip.js`. A versão de navegador só lê `options.arrayBuffer`; a de Node lê `path`, `buffer` ou `file`. Passar só `{ buffer }` cai em `Could not find file in options`.
- **Correção aplicada:** passar os dois campos, `extractRawText({ buffer: buf, arrayBuffer })`, com `arrayBuffer` cópia exata dos bytes do `Buffer` (`buf.buffer.slice(byteOffset, byteOffset + byteLength)`). Em Node nada muda (o build de Node ignora `arrayBuffer`).
- **Validação:** `npx tsc --noEmit` limpo; `npx eslint lib/ingest.ts` limpo; `tests/ingest.formatos.test.ts` passa (3 testes; nenhum cobre docx); `baseline-node.mts` extrai o docx em Node (57.991 caracteres); no Worker o mesmo arquivo extrai 57.991 caracteres, igual.
- Custo: uma cópia do arquivo em memória só no caminho do docx. Para evitar a cópia no Worker, receber o `ArrayBuffer` direto do `R2.get().arrayBuffer()` quando a extração rodar no Worker.
- Falta um teste de docx em `tests/` (o fixture é gerado em `spike/.fixtures/`, fora do git). Fica para quem implementar a fase 3.

## Build OpenNext

- `npx opennextjs-cloudflare build` compila sem erros nem avisos (Next 16.4.6, @opennextjs/cloudflare 1.20.19).
- Bundle enviado pelo wrangler (`wrangler deploy --dry-run`, local): **12,3 MiB bruto / 2,64 MiB gzip**. Cabe no limite do plano Free (3 MiB) com pouca folga e com folga no Paid (10 MiB). Remover `@aws-sdk/client-bedrock-runtime` (Fase 1) deve reduzir.
- `.open-next/server-functions/`: 36 MB em disco, maior arquivo `default/handler.mjs` (8,4 MB). `.open-next/assets/`: 1,1 MB.
- `npx vinext check`: não executado (vinext não instalado; registro opcional).

## Recomendação

**Extração no Container, com o Worker limitado a formatos baratos.** Motivo: xlsx e pdf com texto consomem de 5 a 40 vezes o tamanho do arquivo, o limite de 128 MB por isolate não pode ser testado localmente, e o mesmo código em Node já chega a 1,4 GB com um xlsx de 25 MB.

| Formato | Onde extrair | Limite de tamanho sugerido |
|---|---|---|
| .txt, .md, .json, .csv, .vtt | Worker | 10 MB |
| .docx, .odt, .pptx | Worker | 10 MB (acima disso, Container) |
| .pdf | Container | 25 MB (o `MAX_UPLOAD_MB` atual) |
| .xlsx, .xls | Container | 25 MB; limitar linhas e caracteres ao que o prompt usa (hoje 200 mil caracteres de transcrição), porque 37 M caracteres de saída não servem para nada |
| .png, .jpg, .jpeg, .webp | Worker (só repassa bytes ao Bedrock) | 5 MB, limite de entrada do Converse. Não medido |

Se o Container ficar fora do caminho, o menor limite seguro no Worker é pdf e xlsx até ~1 MB, e isso também não foi comprovado contra os 128 MB. Container com pelo menos 2 GiB de RAM para o xlsx de 25 MB (o Node usou 1,4 GB).

## Impactos nas fases 1 a 4

- **Fase 1.**
  - Trocar Ajv por validador sem `new Function` (por exemplo `@cfworker/json-schema`) ou gerar o código dos validadores no build com o modo standalone do Ajv. O `lib/schemas.ts` (`validar`) é chamado em toda resposta do LLM, então bloqueia o Worker inteiro. Não alterei isso.
  - `lib/config.ts` já aceita `BEDROCK_API_KEY` e `AWS_BEARER_TOKEN_BEDROCK` por `process.env`; o `process.env` do spike foi populado por `.dev.vars` com `nodejs_compat`, então a leitura por `getCloudflareContext().env` pode esperar.
  - `wrangler.jsonc` do spike usa `compatibility_date` 2026-11-23 e flags `nodejs_compat` e `global_fetch_strictly_public`; tudo que o spike importa de `lib/` carregou sem outros erros (ingest, cancelamento, bedrock, config).
- **Fase 2.** O `AsyncLocalStorage` funciona, então `comCancelamento`/`checarCancelado` continuam valendo no consumidor da fila sem mudança.
- **Fase 3.**
  - Sem o Container, `PUT .../anexos` em streaming para R2 segue válido, mas a extração de pdf e xlsx não pode ocorrer no Worker. O consumidor `leitura` chama o Container para esses formatos e o Worker para os demais.
  - Isso antecipa o Container para a fase 3 (o plano o colocava na fase 4). O Container de extração pode ser o mesmo do deck (Python) ou um Node separado; o código atual de extração é TypeScript, então reaproveitar `lib/ingest.ts` em um Container Node evita reescrever.
  - Rejeitar no upload o que passar do limite por formato.
  - O medidor (D4) pode usar `usage.inputTokens` direto.
- **Fase 4.** O contexto de build do `deck-service/Dockerfile` é `luiz/` (pai de `atlas/`). A configuração de Container do wrangler precisa apontar `image` para esse Dockerfile e o contexto de build para o diretório pai, ou o Dockerfile precisa ser copiado para dentro de `atlas/`. Docker local funciona.

## Pendências da fase 0

- Build do OpenNext e tamanho do bundle: feito (seção acima).
- Gerar um deck pelo Container local com `tests/deck.integration.test.ts` (não feito: só registrar, conforme combinado).
- Rodar `npx vinext check` (opcional, só registro).
- Testar docx/pptx com 25 MB de texto real, imagem pelo Bedrock e a memória real do isolate (exige deploy de staging ou limite aplicado no workerd).
