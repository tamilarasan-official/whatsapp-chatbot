# Deploying to Dokploy (Docker Compose)

One repo and one compose service. The Express server serves the chat UI (`/`), the API (`/api/*`)
and the dummy data and PDFs. Dokploy builds the image from the `Dockerfile`, Traefik handles
HTTPS and the domain, and the OpenAI key lives only in Dokploy's Environment tab.

```
Browser ──HTTPS──> Traefik (Dokploy) ──HTTP :3000──> app (Node 20, Express)
                                                      ├─ /            chat UI (public/)
                                                      ├─ /api/chat    ──> OpenAI API
                                                      ├─ /api/health  health check
                                                      └─ /data, /assets
```

## Files involved

| File | Purpose |
|---|---|
| `docker-compose.yml` | What Dokploy deploys. One service, `app`, with `expose: 3000` only (no host port), env vars passed in with `${...}`, health check, read-only filesystem, 256 MB memory limit and log rotation. |
| `Dockerfile` | Node 20 Alpine, `npm ci --omit=dev`, runs as the non-root `node` user, built-in health check. |
| `.dockerignore` | Keeps `.env`, `.git` and `node_modules` out of the image. |
| `docker-compose.local.yml` | Local testing only. Publishes the app on `localhost:3080`. Dokploy ignores it. |

## Plan

### 1. Before deploying (one time)
- [ ] Create a **new** OpenAI API key (the old one was pasted into chat) and set a monthly usage limit in the OpenAI dashboard.
- [ ] Push the repo to GitHub or GitLab. `.env` is git-ignored. Run `git ls-files | grep .env` and check that only `.env.example` is listed.
- [ ] Choose a domain, e.g. `demo.yourcompany.com`, and add a DNS **A record** that points to the Dokploy server IP.

### 2. Create the Compose service in Dokploy
1. **Project**: create a new one (e.g. *WhatsApp AI Demo*) or open an existing one.
2. **Create Service**: choose **Compose**, then **Docker Compose** (not *Stack*, because Stack does not support `build:`).
3. **General → Provider**: pick your Git provider, repo and branch (`main`). Set **Compose Path** to `./docker-compose.yml`.
4. **Environment**: paste the following and click Save.
   ```
   OPENAI_API_KEY=sk-...your-new-key...
   OPENAI_MODEL=gpt-4.1-mini
   ```
   Optional settings and their defaults: `LLM_TIMEOUT_MS=8000`, `RATE_LIMIT_PER_MIN=30`, `TRUST_PROXY=1`.
   If `OPENAI_API_KEY` is missing, the deploy fails on purpose with the message *"Set OPENAI_API_KEY in Dokploy > Environment"*.
5. **Domains → Add Domain**:
   - Service name: `app`
   - Host: `demo.yourcompany.com` (or click the dice icon for a free `traefik.me` test domain)
   - Path: `/`
   - Container port: **3000**
   - HTTPS: **on**, Certificate: **Let's Encrypt**
6. **Deploy**. Watch the build in **Deployments**. The first build takes about 1–2 minutes.

### 3. Verify after deploying
- [ ] `https://<domain>/api/health` returns `{"ok":true,"provider":"openai","model":"gpt-4.1-mini","kbItems":15,"aiConfigured":true}`.
- [ ] Open `https://<domain>/`. There should be no yellow "AI not configured" badge in the top bar.
- [ ] Type `hi, how are you?` and get a natural reply marked ✦ AI.
- [ ] Type `REF-2026-10452`. A status card appears.
- [ ] Go through Menu → Get documents → the PDF opens.
- [ ] Type `enaku certificate eppadi download pannanum?`. The reply comes back in Tanglish.
- [ ] Check that the service shows **healthy** in **Logs / Monitoring**, and that the log has the line `AI enabled (OpenAI)`.
- [ ] From your laptop, run `BASE_URL=https://<domain> npm run test:ai`. All 10 should return 200.

### 4. Updating
- Push to the branch and click **Deploy** (or enable **Auto Deploy** / the webhook in General).
- To change the model or key, edit the **Environment** tab and **Redeploy**. You do not need to change any code.
- To roll back, redeploy an earlier deployment from the **Deployments** tab.

### 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "required variable OPENAI_API_KEY is missing" | Add it in **Environment**, save and redeploy. |
| 404 or "Bad Gateway" on the domain | In **Domains**, the container port must be `3000` and the service `app`. Use **Preview Compose** to check the Traefik labels. |
| Yellow "AI not configured · fallback active" badge | The key did not reach the container. Check the Environment tab and redeploy. |
| Bot always replies "Let me connect you to an officer" | Check the logs for `[chat] failed (...)`. A 401 means a bad key, 429 means the OpenAI quota is used up, 504 means a timeout (raise `LLM_TIMEOUT_MS`). |
| HTTPS certificate not issued | The DNS A record must point to the server, and ports 80 and 443 must be open. |

## Security notes
- The key is only in Dokploy's Environment tab (written to a `.env` on the server). It is not in Git or the image, and it is never sent to the browser.
- The container runs as a non-root user on a read-only filesystem with `no-new-privileges`, and has no host port, so it is reachable only through Traefik.
- `/api/chat` is rate-limited per client IP. `TRUST_PROXY=1` makes the limit use the real visitor IP behind Traefik.
- All data in the app is dummy data. There is no database and nothing to back up.
