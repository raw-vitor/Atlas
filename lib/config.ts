import os from "node:os";
import path from "node:path";

const env = (k: string, d: string) => (process.env[k] ?? "").trim() || d;

export const config = {
  region: env("BEDROCK_REGION", "us-east-1"),
  modelId: env("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6"),
  // Chave do Bedrock (Bearer). Sem ela, o SDK usa as credenciais AWS padrão do ambiente.
  apiKey: env("BEDROCK_API_KEY", "") || env("AWS_BEARER_TOKEN_BEDROCK", ""),
  // Endpoint do Bedrock Runtime (VPC endpoint, proxy ou mock de teste). Padrão: o endpoint público da região.
  endpoint: env("BEDROCK_ENDPOINT", ""),
  deckServiceUrl: env("DECK_SERVICE_URL", "http://127.0.0.1:8180"),
  knowledgeDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), env("KNOWLEDGE_DIR", "../conhecimento")),
  workDir: env("WORK_DIR", path.join(os.tmpdir(), "atlas_jobs")),
  jobTtlMin: Number(env("JOB_TTL_MIN", "60")),
  maxUploadMb: Number(env("MAX_UPLOAD_MB", "25")),
  llmTimeoutMs: Number(env("BEDROCK_TIMEOUT_MS", "300000")),
  llmRetries: 2,
  // Triagem de cada arquivo por LLM (ATLAS_TRIAGEM_LLM=0 desliga e deixa só a contagem de sinais).
  triagemLlm: env("ATLAS_TRIAGEM_LLM", "1") !== "0",
};
