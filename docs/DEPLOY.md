# Deploying to Dokploy (Docker Compose, two domains)

One repo and one compose file with two services:

| Domain | Service | What it serves |
|---|---|---|
| `https://valardemo.welocalhost.com` | `frontend` (nginx, port 3000) | Chat UI, `/data/*.json`, `/assets/*.pdf` |
| `https://apivalardemo.welocalhost.com` | `backend` (Node 20, Express, our search model, port 3000) | `/api/chat`, `/api/complaint/:ref`, `/api/health` |

```
Browser ──HTTPS──> Traefik (Dokploy) ──┬──> frontend :3000 valardemo.welocalhost.com
                                       └──> backend  :3000 apivalardemo.welocalhost.com ──> OpenAI
```

The browser loads the UI from the frontend domain and calls the API on the backend domain.
- The frontend container writes `config.js` at startup with `apiBase: 'https://apivalardemo.welocalhost.com'`.
- The backend only allows CORS from `https://valardemo.welocalhost.com`.
- The OpenAI key is only on the backend.
- The search model (118 MB, too big for GitHub) lives in the **private** Hugging Face repo
  `tam-valar01/secbihar-search-v2`. The backend build downloads it with a read-only `HF_TOKEN` passed as a
  BuildKit secret and checks its SHA-256 (`docker/fetch-model.js`). The token is not stored in the image.

## Files involved

| File | Purpose |
|---|---|
| `docker-compose.yml` | What Dokploy deploys. Two services, both listening on port 3000 internally, with no host ports. The domains are added in Dokploy's Domains tab. |
| `Dockerfile` | Backend image: Node 20 Debian slim (the ML runtime needs glibc). Stage 1 downloads and verifies the model; stage 2 has production dependencies only (CPU runtime, no CUDA), non-root, health check. About 880 MB. |
| `docker/fetch-model.js` | Build step: downloads the model with the `hf_token` secret and verifies its checksum. |
| `docker/frontend.Dockerfile` | Frontend image: nginx Alpine with the static UI. |
| `docker/40-app-config.sh` | Runs when the frontend starts. Writes `config.js` from `API_BASE_URL`. |
| `docker/nginx.conf` | Static serving, gzip, security headers, `/healthz`, no-cache for `config.js`. |
| `docker-compose.local.yml` | Local testing only. Frontend on `:3080`, backend on `:3081`. Dokploy ignores it. |

## Plan

### 1. Before deploying (one time)
- [ ] **DNS:** add two A records pointing to the Dokploy server IP:
  - `valardemo.welocalhost.com` → `<server IP>`
  - `apivalardemo.welocalhost.com` → `<server IP>`
- [ ] Make sure ports **80 and 443** are open on the server. Let's Encrypt needs port 80.
- [ ] Create a **new** OpenAI API key and set a usage limit in the OpenAI dashboard.
- [ ] Create a Hugging Face **read-only** token (fine-grained, read access to `tam-valar01/secbihar-search-v2`).
- [ ] Server: at least **1.5 GB free RAM** (backend limit 1 GB, uses ~500 MB) and **3 GB free disk** for the build.
  Check with `free -m` and `df -h`. Docker Compose **v2.23 or newer** (`docker compose version`) for build secrets.

### 2. Create the Compose service in Dokploy
1. **Create Service**: choose **Compose**, then **Docker Compose** (not *Stack*).
2. **General → Provider**: GitHub, repo `tamilarasan-official/whatsapp-chatbot`, branch `main`, Compose Path `./docker-compose.yml`.
3. **Environment**: paste the following and click Save.
   ```
   OPENAI_API_KEY=sk-...your-new-key...
   OPENAI_MODEL=gpt-5.4-mini
   HF_TOKEN=hf_...read-only-token...
   ```
   The API URL and CORS origin already default to the two domains. Override them here only if the domains change:
   ```
   API_BASE_URL=https://apivalardemo.welocalhost.com
   CORS_ORIGIN=https://valardemo.welocalhost.com
   ```
4. **Domains → Add Domain** twice:

   | Service | Host | Path | Container port | HTTPS | Certificate |
   |---|---|---|---|---|---|
   | `frontend` | `valardemo.welocalhost.com` | `/` | **3000** | on | Let's Encrypt |
   | `backend` | `apivalardemo.welocalhost.com` | `/` | **3000** | on | Let's Encrypt |

5. **Deploy**. Both services build. The first build takes about 3–6 minutes (npm install + 118 MB model download).

### 3. Verify after deploying
- [ ] `https://apivalardemo.welocalhost.com/api/health` returns `"ok":true`, `"model":"gpt-5.4-mini"`, `"aiConfigured":true` and `"embedding":"e5-small-ft2"`.
- [ ] `https://valardemo.welocalhost.com/config.js` returns `window.APP_CONFIG = { apiBase: 'https://apivalardemo.welocalhost.com' };`
- [ ] `http://valardemo.welocalhost.com` redirects to `https://`.
- [ ] Open `https://valardemo.welocalhost.com`. There should be no yellow "AI not configured" badge.
- [ ] Tap हिन्दी, open a menu topic and an FAQ. Type `ग्राम पंचायत का कार्यकाल कितने वर्ष का होता है?`: a ✦ AI reply citing Section 14; its card opens the Act PDF. Type `CMP-2026-00412`: a complaint card. Repeat a question in English and in Tamil.
- [ ] Browser DevTools → Console: no CORS errors.
- [ ] From your laptop, run `BASE_URL=https://apivalardemo.welocalhost.com npm run test:ai`. All 16 should return 200.

### 4. Updating
- Push to `main`, then click **Deploy** (or enable **Auto Deploy** in General).
- If you change a key, model or domain in **Environment**, click **Redeploy**.
- To roll back, redeploy an earlier entry in the **Deployments** tab.

### 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "required variable OPENAI_API_KEY is missing" | Add it in **Environment**, save and redeploy. |
| Build fails at `fetch-model.js` with HTTP 401/403 | `HF_TOKEN` is missing, wrong, or has no read access to `tam-valar01/secbihar-search-v2`. |
| Build fails with "checksum mismatch" | The model in the Hugging Face repo was changed. Re-upload the right file, or update `MODEL_SHA256` in the `Dockerfile` after rebuilding the index. |
| Build error about `secrets` / `hf_token` | Docker Compose on the server is older than v2.23. Update Docker, or ask for the runtime-download fallback. |
| Backend restarts / "Killed" | Out of memory: the backend needs its 1 GB limit and ~500 MB free on the server. |
| `404 page not found` (Traefik) on a domain | DNS is not pointing to the server yet, or the domain is not added in the Domains tab. Use **Preview Compose** to check the generated labels. |
| `Bad Gateway` on a domain | The container port in the Domains tab must be **3000** for both services. |
| Certificate warning / no HTTPS | The DNS A record must resolve to the server and port 80 must be open. Let's Encrypt retries automatically. |
| UI loads but the bot always says "connect you to an officer" | Open DevTools. A **CORS error** means `CORS_ORIGIN` must exactly equal the frontend URL (`https://`, no trailing slash). A **401/429** in the backend logs means a bad key or the OpenAI quota is used up. |
| Yellow "AI not configured" badge | The frontend can't reach `/api/health`. Check `config.js` and the API domain. |
| A domain shows the wrong app | Check that each domain in the Domains tab points to the right service (`frontend` or `backend`). |

## WhatsApp (real number)

The backend ships with the WhatsApp Cloud API channel built in. Without the `WHATSAPP_*` env vars it runs in
dry-run mode and the deploy above is unaffected. To connect the client's number: **docs/WHATSAPP.md**
(env values to collect, Meta webhook configuration, test number, templates, officer endpoints, troubleshooting).
Session profiles (language, STOP, complaints per number) are stored in the `wa-state` volume defined in
`docker-compose.yml`.

## Security notes
- The key is only in Dokploy's Environment tab and is passed to the **backend only**. It is not in Git, not in either image, and never sent to the browser.
- `HF_TOKEN` is used only in the build's first stage as a BuildKit secret; it is not in any image layer (verified with `docker history` and a file search of the image).
- Only the small top-level `/data/*.json` files reach the browser; `data/kb` (index, model) stays in the backend.
- The backend is API-only (`SERVE_STATIC=false`), runs as a non-root user on a read-only filesystem, and its CORS is locked to the frontend domain.
- Neither service publishes a host port. Traffic reaches them only through Traefik over HTTPS.
- `/api/chat` is rate-limited per client IP. `TRUST_PROXY=1` makes the limit use the real visitor IP behind Traefik.
