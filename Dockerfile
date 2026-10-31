# syntax=docker/dockerfile:1
# Production image for Dokploy (or any Docker host).
# Debian slim, not Alpine: onnxruntime-node (the search model runtime) needs glibc.

# ---- 1. search model: downloaded with a build secret, checksum verified (the token stays in this stage)
FROM node:20-bookworm-slim AS model
ARG MODEL_REPO=tam-valar01/secbihar-search-v2
ARG MODEL_SHA256=ba9a363d793a8a748cde880ef81d670ca16ce47c4bb01eb1ba246720429cf611
COPY docker/fetch-model.js /fetch-model.js
RUN --mount=type=secret,id=hf_token,required=true \
    node /fetch-model.js "$MODEL_REPO" "$MODEL_SHA256" /model/model_quantized.onnx

# ---- 2. app
FROM node:20-bookworm-slim
ARG TARGETARCH=amd64

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
# CPU only: skip onnxruntime's 340 MB CUDA download, then keep only this platform's binaries
# (Windows / macOS / other-arch files, ~170 MB, removed). GPU provider libraries are dropped too.
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --omit=dev && npm cache clean --force \
 && ARCH=$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x64) \
 && cd node_modules/onnxruntime-node/bin/napi-v3 \
 && rm -rf win32 darwin $(ls -d linux/* | grep -v "linux/$ARCH") \
 && rm -f linux/*/libonnxruntime_providers_cuda.so linux/*/libonnxruntime_providers_tensorrt.so

COPY server ./server
COPY public ./public
COPY data ./data
COPY --from=model /model/model_quantized.onnx ./data/kb/index/model/onnx/model_quantized.onnx
COPY scripts/test-ai.js ./scripts/test-ai.js

USER node
EXPOSE 3000

# No wget in the slim image: use Node's fetch. Longer start period: the search model loads at startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
