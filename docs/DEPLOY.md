# Deploying to Dokploy (Docker Compose, two domains)

One repo and one compose file with two services:

| Domain | Service | What it serves |
|---|---|---|
| `https://valardemo.welocalhost.com` | `frontend` (nginx, port 3000) | Chat UI, `/data/*.json`, `/assets/*.pdf` |
| `https://apivalardemo.welocalhost.com` | `backend` (Node 20, Express, port 3000) | `/api/chat`, `/api/application/:ref`, `/api/health` |

```
Browser ──HTTPS──> Traefik (Dokploy) ──┬──> frontend :3000 valardemo.welocalhost.com
                                       └──> backend  :3000 apivalardemo.welocalhost.com ──> OpenAI
```

The browser loads the UI from the frontend domain and calls the API on the backend domain.
- The frontend container writes `config.js` at startup with `apiBase: 'https://apivalardemo.welocalhost.com'`.
- The backend only allows CORS from `https://valardemo.welocalhost.com`.
- The OpenAI key is only on the backend.

## Files involved

| File | Purpose |
|---|---|
| `docker-compose.yml` | What Dokploy deploys. Two services, both listening on port 3000 internally, with no host ports. The domains are added in Dokploy's Domains tab. |
| `Dockerfile` | Backend image: Node 20 Alpine, production dependencies only, non-root, health check. |
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

### 2. Create the Compose service in Dokploy
1. **Create Service**: choose **Compose**, then **Docker Compose** (not *Stack*).
2. **General → Provider**: GitHub, repo `tamilarasan-official/whatsapp-chatbot`, branch `main`, Compose Path `./docker-compose.yml`.
3. **Environment**: paste the following and click Save.
   ```
   OPENAI_API_KEY=sk-...your-new-key...
   OPENAI_MODEL=gpt-4.1-mini
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

5. **Deploy**. Both services build. The first build takes about 1–2 minutes.

### 3. Verify after deploying
- [ ] `https://apivalardemo.welocalhost.com/api/health` returns `{"ok":true,...,"aiConfigured":true}`.
- [ ] `https://valardemo.welocalhost.com/config.js` returns `window.APP_CONFIG = { apiBase: 'https://apivalardemo.welocalhost.com' };`
- [ ] `http://valardemo.welocalhost.com` redirects to `https://`.
- [ ] Open `https://valardemo.welocalhost.com`. There should be no yellow "AI not configured" badge.
- [ ] Type `hi, how are you?` and get a natural reply marked ✦ AI. Type `REF-2026-10452` and get a status card.
- [ ] Browser DevTools → Console: no CORS errors.
- [ ] From your laptop, run `BASE_URL=https://apivalardemo.welocalhost.com npm run test:ai`. All 10 should return 200.

### 4. Updating
- Push to `main`, then click **Deploy** (or enable **Auto Deploy** in General).
- If you change a key, model or domain in **Environment**, click **Redeploy**.
- To roll back, redeploy an earlier entry in the **Deployments** tab.

### 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "required variable OPENAI_API_KEY is missing" | Add it in **Environment**, save and redeploy. |
| `404 page not found` (Traefik) on a domain | DNS is not pointing to the server yet, or the domain is not added in the Domains tab. Use **Preview Compose** to check the generated labels. |
| `Bad Gateway` on a domain | The container port in the Domains tab must be **3000** for both services. |
| Certificate warning / no HTTPS | The DNS A record must resolve to the server and port 80 must be open. Let's Encrypt retries automatically. |
| UI loads but the bot always says "connect you to an officer" | Open DevTools. A **CORS error** means `CORS_ORIGIN` must exactly equal the frontend URL (`https://`, no trailing slash). A **401/429** in the backend logs means a bad key or the OpenAI quota is used up. |
| Yellow "AI not configured" badge | The frontend can't reach `/api/health`. Check `config.js` and the API domain. |
| A domain shows the wrong app | Check that each domain in the Domains tab points to the right service (`frontend` or `backend`). |

## Security notes
- The key is only in Dokploy's Environment tab and is passed to the **backend only**. It is not in Git, not in either image, and never sent to the browser.
- The backend is API-only (`SERVE_STATIC=false`), runs as a non-root user on a read-only filesystem, and its CORS is locked to the frontend domain.
- Neither service publishes a host port. Traffic reaches them only through Traefik over HTTPS.
- `/api/chat` is rate-limited per client IP. `TRUST_PROXY=1` makes the limit use the real visitor IP behind Traefik.
