FROM node:22-slim AS build
WORKDIR /app
COPY atlas/package*.json ./
RUN npm ci
COPY atlas/ .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production KNOWLEDGE_DIR=/conhecimento
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY conhecimento /conhecimento
USER node
EXPOSE 3000
CMD ["node", "server.js"]
