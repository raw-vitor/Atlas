-- Configuração do prompt por assessor.
-- Uma linha JSON por usuário com só a diferença em relação ao prompt original. "Restaurar tudo" grava dados vazios com
-- versao + 1, sem apagar a linha: a versão nunca se repete, e o alerta de versão anterior depende disso.

CREATE TABLE config_prompt (
  usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id),
  dados TEXT NOT NULL,        -- JSON de DadosConfig (lib/prompt-tipos.ts)
  versao INTEGER NOT NULL,
  atualizada INTEGER NOT NULL
);
