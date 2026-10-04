# Frontend: static chat UI served by nginx. The API URL is injected at container start.
FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
COPY public /usr/share/nginx/html
COPY data /usr/share/nginx/html/data

RUN chmod +x /docker-entrypoint.d/40-app-config.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
