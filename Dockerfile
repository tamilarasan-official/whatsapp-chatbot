# Production image for Dokploy (or any Docker host).
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY data ./data
COPY scripts/test-ai.js ./scripts/test-ai.js

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "server/index.js"]
