# One image per service, built from this workspace: docker build --target indexer|bot|dashboard .
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/indexer/package.json packages/indexer/
COPY packages/bot/package.json packages/bot/
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM deps AS src
COPY . .
RUN mkdir -p /data && chown node:node /data

FROM src AS indexer
WORKDIR /app/packages/indexer
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/watchlayer.db
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM src AS bot
WORKDIR /app/packages/bot
ENV NODE_ENV=production BOT_DB_PATH=/data/bot.db API_URL=http://indexer:8080
USER node
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM src AS dashboard
RUN npm run build -w @watchlayer/dashboard
WORKDIR /app/apps/dashboard
ENV NODE_ENV=production API_URL=http://indexer:8080
USER node
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
