# Atlas

Chat que gera o deck de R2 (Next.js + Chakra UI + Bedrock). Plano em `../PLANO_ATLAS.md`.

    cp .env.local.example .env.local       # preencher BEDROCK_API_KEY
    npm install
    npm run dev                            # sobe o deck-service (porta 8180, com reload) e o Next (http://localhost:3000)

`npm run dev` roda `scripts/dev.mjs`: confere os pré-requisitos (`../.venv`, `node_modules`, `KNOWLEDGE_DIR`, credencial do Bedrock, `soffice`), sobe o deck-service, espera o `/health` e então sobe o Next. Ctrl+C encerra os dois. Se já houver um deck-service no ar com o mesmo schema, ele é reaproveitado e não é encerrado no fim. Se o que estiver no ar tiver schema diferente, o script para e mostra como encerrá-lo. Só o Next: `npm run dev:next`. `/api/health` testa Bedrock e deck-service.

Testes: `npm test` (paridade com o Python; o de deck roda se o deck-service estiver no ar).
Mudou `app/schemas.py`? Três passos: (1) `../.venv/bin/python ../deck-service/export_schemas.py`, (2) reiniciar o deck-service (ou `RELOAD=1 ../deck-service/run.sh` em desenvolvimento), (3) em Docker, `docker compose up -d --build deck-service`. O Atlas compara o `schema_hash` do `/health` com o de `lib/schemas/constantes.json` e recusa o deck se forem diferentes. `tests/schemas.drift.test.ts` falha se os JSON não baterem com o Python.

Regerar referência de paridade: `../.venv/bin/python ../tests/parity_dump.py` e `../.venv/bin/python ../deck-service/export_schemas.py`.
Docker: `docker compose up --build` na pasta acima (ver `.env.local`).
