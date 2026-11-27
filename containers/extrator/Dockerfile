# Container "Extrator": extrai texto de .pdf, .xlsx e .xls com lib/ingest.ts (Node).
# Contexto de build: atlas/ (wrangler: image_build_context ".").  Teste local:
#   docker build -f containers/extrator/Dockerfile -t atlas-extrator .
# O BuildKit só envia ao build o que os COPY abaixo pedem (package*.json, lib/, containers/extrator/): node_modules, .env e
# .git do contexto não entram na imagem. O wrangler passa o Dockerfile por stdin, então um .dockerignore ao lado dele não valeria.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY lib ./lib
COPY containers/extrator ./containers/extrator
# Tudo empacotado em um arquivo só: a imagem final não precisa de node_modules.
# @opennextjs/cloudflare só é importado por lib/cf.ts, e o extrator nunca chama o Bedrock (imagens ficam no Worker).
RUN node_modules/.bin/esbuild containers/extrator/server.ts --bundle --platform=node --format=esm --target=node22 \
      --external:@opennextjs/cloudflare --external:cloudflare:workers \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=/out/server.mjs --log-level=warning

FROM node:22-slim
WORKDIR /srv
COPY --from=build /out/server.mjs ./server.mjs
# 2 GiB de RAM no Container: deixa folga para o processo além do heap do V8.
ENV NODE_ENV=production PORT=8181 NODE_OPTIONS=--max-old-space-size=1536
USER node
EXPOSE 8181
CMD ["node", "server.mjs"]
