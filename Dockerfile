# Production image for Dokploy (or any Docker host).
# Debian slim, not Alpine: onnxruntime-node (the search model runtime) needs glibc.
FROM node:20-bookworm-slim

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

# No wget in the slim image: use Node's fetch. Longer start period: the search model loads at startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
