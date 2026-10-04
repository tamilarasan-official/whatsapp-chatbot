#!/bin/sh
# Runs on nginx container start: writes config.js so the UI calls the backend domain.
set -eu
API_BASE_URL="${API_BASE_URL:-}"
if [ -n "$API_BASE_URL" ] && ! printf '%s' "$API_BASE_URL" | grep -Eq '^https?://[A-Za-z0-9.:/_-]+$'; then
  echo "app-config: API_BASE_URL must look like https://api.example.com (got: $API_BASE_URL)" >&2
  exit 1
fi
printf "window.APP_CONFIG = { apiBase: '%s' };\n" "$API_BASE_URL" > /usr/share/nginx/html/config.js
echo "app-config: apiBase=${API_BASE_URL:-<same origin>}"
