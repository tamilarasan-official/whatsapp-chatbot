# WhatsApp Cloud API: going live on a real number

The backend already contains the WhatsApp channel: `GET/POST /webhook/whatsapp` for Meta and
`/api/whatsapp/admin/*` for officers. Without the four `WHATSAPP_*` values it runs in **dry-run mode**
(outgoing messages are logged, nothing is sent), so the normal deploy (docs/DEPLOY.md) keeps working unchanged.
Going live is configuration only: no code change, no rebuild.

## What the client (or we, with their Business Manager access) must provide

| Value | Where it comes from | Env var |
|---|---|---|
| Phone number ID | Meta for Developers > App > WhatsApp > API Setup | `WHATSAPP_PHONE_NUMBER_ID` |
| Permanent access token | Business Settings > System Users > Add > assign the WhatsApp app > Generate token with `whatsapp_business_messaging` and `whatsapp_business_management` | `WHATSAPP_ACCESS_TOKEN` |
| App secret | App > App settings > Basic > App secret | `WHATSAPP_APP_SECRET` |
| Verify token | any long random string we choose (`openssl rand -hex 24`) | `WHATSAPP_VERIFY_TOKEN` |

Also set `ADMIN_TOKEN` (random string) so officers can use the admin endpoints, and keep
`PUBLIC_ASSETS_BASE` pointing at the frontend domain (Act PDFs are sent as document messages from there).

## Steps

1. **Environment** in Dokploy: add the five values above, Save, **Redeploy** the backend.
   `https://apivalardemo.welocalhost.com/api/health` must now show `"whatsapp":{"configured":true,"dryRun":false,...}`.
2. **Webhook** in Meta for Developers > App > WhatsApp > Configuration:
   - Callback URL: `https://apivalardemo.welocalhost.com/webhook/whatsapp`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` value. Click *Verify and save* (the server answers the handshake).
   - Webhook fields: subscribe to **messages**.
3. **Test number first**: in API Setup add your own phone as a recipient, send "hi" to the test number.
   You should get the consent message with the हिन्दी / English buttons. Tap through a topic, an FAQ,
   `CMP-2026-00412`, "officer", STOP and START.
4. **Production number**: add the client's number to the WhatsApp Business Account (SMS/voice OTP),
   set the display name, switch `WHATSAPP_PHONE_NUMBER_ID` to the new number's ID, Redeploy.
   Business verification must be complete before the number can message people who did not message first
   and before the 250-conversations-per-day starter limit is lifted.
5. **Templates** (only for proactive complaint updates): create a utility template, e.g. `complaint_update`
   in `hi` and `en` with body `Update: the status of your complaint {{1}} is now {{2}}.`, wait for approval,
   set `WHATSAPP_TEMPLATE_COMPLAINT_UPDATE=complaint_update`. Inside the 24-hour window after a user's last
   message a normal message is sent instead, so the bot works without templates from day one.

## Verify after going live
- [ ] `/api/health` shows `configured: true`, `dryRun: false`.
- [ ] Backend logs show `WhatsApp: live, webhook /webhook/whatsapp, phone number id …1234`.
- [ ] Meta > WhatsApp > Configuration shows the webhook as verified and `messages` subscribed.
- [ ] A message from a real phone gets blue ticks, the typing indicator and a reply within a few seconds.
- [ ] Tap an Act in *Acts & documents*: the PDF arrives as a document (needs `PUBLIC_ASSETS_BASE` reachable from the internet).
- [ ] `npm run test:wa` passes on the deployed commit (offline test of the whole conversation + webhook).

## Officer endpoints (Bearer `ADMIN_TOKEN`)

```bash
H='Authorization: Bearer <ADMIN_TOKEN>'
B=https://apivalardemo.welocalhost.com/api/whatsapp/admin
curl -H "$H" $B/handovers                                                                     # who is waiting
curl -H "$H" -H 'Content-Type: application/json' -d '{"to":"9198xxxxxxxx","text":"Namaste, help desk here."}' $B/reply
curl -H "$H" -H 'Content-Type: application/json' -d '{"to":"9198xxxxxxxx"}' $B/close          # hand back to the bot
curl -H "$H" -H 'Content-Type: application/json' -d '{"to":"9198xxxxxxxx","ref":"CMP-2026-00412","status":"approved"}' $B/notify
curl -H "$H" $B/session/9198xxxxxxxx                                                          # state without transcript
```
`HANDOVER_WEBHOOK_URL` (optional) receives a JSON POST (phone, name, language, reason, last 20 turns) whenever a
chat is handed over or the user writes during a handover: point it at a queue, a Slack/Teams webhook or an email bridge.

## Behaviour on WhatsApp (differences from the web demo)
- First contact: consent + language buttons; the user's first question is answered right after the language is picked.
- Menu and FAQ lists are WhatsApp list messages (10 rows): 9 questions + "More questions…". Rows are numbered and
  the user can also reply with the number. Long FAQ answers are split (1024-character interactive body limit).
- Complaint status is a text card; Acts arrive as PDF document messages; citations are a "📌 Source" line with a
  link to the PDF page.
- Officer handover: the bot goes quiet, the officer answers through the admin API (or a tool built on it); the
  user can type *menu* to come back; after `HANDOVER_TTL_MIN` (60) without an officer reply the bot resumes.
- STOP/START are honoured for proactive messages and persist across redeploys (`wa-state` volume).
  Photos, voice notes and documents from users get a "text only" reply.
- Per-phone rate limit `WHATSAPP_RATE_LIMIT_PER_MIN` (20): one "please slow down", then silence for that minute.
- Conversations idle for `SESSION_TTL_MIN` (24 h) start fresh (language kept, no second consent).
  Transcripts live in memory only; the volume holds language, consent time, STOP, complaints and reminders per number.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Meta: "The callback URL or verify token couldn't be validated" | `WHATSAPP_VERIFY_TOKEN` differs from the one typed in Meta, or the backend was not redeployed after setting it. `curl 'https://apivalardemo.welocalhost.com/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=1'` must print `1`. |
| Messages arrive (webhook logs) but no reply | `/api/health` shows `dryRun: true`: `WHATSAPP_ACCESS_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` missing. |
| Backend log `Graph API 401` | Token expired (24-hour test token) or revoked. Use a System User permanent token. |
| Backend log `Graph API 400 ... (#131030)` | Recipient not in the test number's allowed list (test numbers only). |
| Backend log `Graph API 400 ... (#131047)` | More than 24 h since the user's last message: only an approved template may be sent. |
| Webhook returns 401 to Meta | `WHATSAPP_APP_SECRET` is wrong (the signature check fails). |
| No PDF arrives | `PUBLIC_ASSETS_BASE` must be reachable publicly over HTTPS and serve the file as `application/pdf`. |
| Bot repeats the consent message after every redeploy | The `wa-state` volume is missing or not writable (backend logs show `[session] could not write`). |
