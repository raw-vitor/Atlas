const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;

export const config = {
  // "production" desliga o cabeçalho x-atlas-dev-usuario e o ATLAS_DEV_USUARIO (lib/auth.ts).
  ambiente: env("ENVIRONMENT", "development"),
  // Usuário local quando não há Cloudflare Access (só fora de produção).
  devUsuario: env("ATLAS_DEV_USUARIO", "dev@eqi.local"),
  // Sobreposição opcional do limite do medidor de contexto. 0 = usar a janela do modelo (lib/modelos.ts).
  contextoTokens: Math.max(0, Math.floor(Number(env("ATLAS_CONTEXTO_TOKENS", "0"))) || 0),
  region: env("BEDROCK_REGION", "us-east-1"),
  modelId: env("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6"),
  // Chave do Bedrock (Bearer). Sem ela, a chamada ao modelo falha com LLMError (o SDK da AWS saiu).
  apiKey: env("BEDROCK_API_KEY", "") || env("AWS_BEARER_TOKEN_BEDROCK", ""),
  // Endpoint do Bedrock Runtime (VPC endpoint, proxy ou mock de teste). Padrão: o endpoint público da região.
  endpoint: env("BEDROCK_ENDPOINT", ""),
  // Só vale quando não há o binding DECK (testes em Node e `next dev`); no Worker o deck-service é o Container.
  deckServiceUrl: env("DECK_SERVICE_URL", "http://127.0.0.1:8180"),
  // Intervalo do batimento do consumidor com o Durable Object (renova o lease e descobre o cancelamento).
  batimentoMs: Math.max(50, Number(env("ATLAS_BATIMENTO_MS", "5000")) || 5000),
  // Tarefas (turno ou deck) que um mesmo isolate executa ao mesmo tempo; as demais esperam e publicam `fila`.
  tarefasPorIsolate: Math.max(1, Math.floor(Number(env("ATLAS_TAREFAS_POR_ISOLATE", "3"))) || 3),
  maxUploadMb: Number(env("MAX_UPLOAD_MB", "25")),
  llmTimeoutMs: Number(env("BEDROCK_TIMEOUT_MS", "300000")),
  llmRetries: 2,
  // Triagem de cada arquivo por LLM (ATLAS_TRIAGEM_LLM=0 desliga e deixa só a contagem de sinais).
  triagemLlm: env("ATLAS_TRIAGEM_LLM", "1") !== "0",
};
