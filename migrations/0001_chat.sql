-- Chat persistente do Atlas (plano, seção 4.1).
-- O estado do caso, a trava, os eventos de progresso e os alertas vistos NÃO ficam aqui: vivem no Durable Object `Conversa`.

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,            -- "sub" do JWT do Cloudflare Access (local: ATLAS_DEV_USUARIO)
  email TEXT NOT NULL UNIQUE,
  criado INTEGER NOT NULL
);

CREATE TABLE conversas (
  id TEXT PRIMARY KEY,            -- 32 hex, mesmo formato de hoje
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  criada INTEGER NOT NULL,
  atualizada INTEGER NOT NULL,
  ctx_tokens INTEGER NOT NULL DEFAULT 0,   -- último valor do medidor (a lista não precisa abrir o DO)
  ctx_limite INTEGER NOT NULL,
  apagada INTEGER                           -- marca de exclusão; a limpeza roda pela fila
);

-- Lista lateral: "minhas conversas ativas, mais recentes primeiro".
CREATE INDEX conversas_usuario ON conversas(usuario_id, apagada, atualizada DESC);
-- Purga: conversas sem uso há 90 dias (apagada IS NULL AND atualizada < ?) e purgas pendentes (apagada IS NOT NULL).
CREATE INDEX conversas_purga ON conversas(apagada, atualizada);

CREATE TABLE mensagens (
  conversa_id TEXT NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                     -- ordem dentro da conversa, dada pelo servidor
  id TEXT NOT NULL,
  id_cliente TEXT,                          -- id gerado pelo navegador (mensagem otimista); só em mensagens do assessor
  tipo TEXT NOT NULL,                       -- usuario | atlas | resultado
  texto TEXT,
  meta TEXT,                                -- JSON: anexos, erro, versao, resultado
  criada INTEGER NOT NULL,
  PRIMARY KEY (conversa_id, seq)
) WITHOUT ROWID;

-- Reenvio do mesmo POST (rede instável, duplo clique) não grava duas mensagens: a segunda inserção falha por esta restrição.
CREATE UNIQUE INDEX mensagens_id_cliente ON mensagens(conversa_id, id_cliente) WHERE id_cliente IS NOT NULL;
