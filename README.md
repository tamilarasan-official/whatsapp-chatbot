# ECI Voter Helpdesk: WhatsApp AI Chatbot Demo

A client demo of a WhatsApp-style voter helpdesk for the **Election Commission of India**.
The voter-service facts are publicly documented ECI information (Form 6/6A/7/8, Voter Helpline
1950, voters.eci.gov.in, cVIGIL, Saksham, ID at the booth). Application records, contacts and
PDFs are **dummy demo data**. This is not an official ECI service.

A switch in the top bar selects one of two chatbot types:

| Mode | How it behaves |
|---|---|
| **Static Chatbot** | Guided WhatsApp journeys: consent, language buttons, menus, FAQ lists, status cards, visit booking, form PDFs, complaints, notifications and officer handover. Free-typed text still goes to the AI, which can open these screens. |
| **✦ AI Chatbot** | The user drives the conversation and **every reply comes from the OpenAI model**. There are no scripted menus. The AI remembers the chat, follows the user's language (English, Hindi, Tamil, Hinglish, Tanglish), answers from the ECI knowledge base, reads the application record when a `REF-…` number is mentioned, stays politically neutral, and hands over to an officer when asked. |

The mode is kept in the URL (`?mode=static` / `?mode=ai`) so you can open the demo straight into either one.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env        # then put your key in OPENAI_API_KEY
npm start                   # http://localhost:3000
```

- `npm run dev` restarts on file changes.
- `npm run test:ai` sends 10 sample questions to `/api/chat` and prints intent, language, confidence and latency (server must be running).
- `http://localhost:3000/?offline=1` turns off the AI and uses scripted flows plus keyword-matched FAQ answers. Use it if the Wi-Fi is unreliable.

Without an API key the app still runs. Free-typed questions get the scripted fallback ("Let me connect you to an officer"), and the top bar shows an "AI not configured" badge.

### Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | none | OpenAI API key. Stays on the server and is never sent to the browser. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model used for live answers |
| `PORT` | `3000` | HTTP port |
| `LLM_TIMEOUT_MS` | `8000` | Server-side LLM timeout |
| `TRUST_PROXY` | `1` | Number of reverse proxies in front of the app (Dokploy/Traefik = 1) |
| `RATE_LIMIT_PER_MIN` | `30` | Requests per minute per IP on `/api/chat` |

Set a usage limit on the key in the OpenAI dashboard before the demo. Rotate the key afterwards if it was shown on screen.

## Deploy on Dokploy (Docker Compose, two domains)

| Domain | Service |
|---|---|
| https://valardemo.welocalhost.com | `frontend`: nginx serving the chat UI |
| https://apivalardemo.welocalhost.com | `backend`: Express API + OpenAI |

Both services listen on container port 3000. The domains are added in Dokploy's **Domains** tab, with HTTPS from Let's Encrypt.
The full plan and checklist are in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

1. Add DNS A records for both domains pointing to the Dokploy server.
2. In Dokploy, choose **Create Service**, then **Compose**, then **Docker Compose**. Pick this repo and set Compose Path to `./docker-compose.yml`.
3. In **Environment**, set `OPENAI_API_KEY=...` (and optionally `OPENAI_MODEL=gpt-4.1-mini`).
4. In **Domains**, add `frontend` → `valardemo.welocalhost.com` (port 3000) and `backend` → `apivalardemo.welocalhost.com` (port 3000), with HTTPS on. Then click **Deploy**.
5. Check `https://apivalardemo.welocalhost.com/api/health`, then open `https://valardemo.welocalhost.com`.

Test the same two-service stack locally (frontend at http://localhost:3080, API at http://localhost:3081):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

For development without Docker, `npm start` still serves the UI and the API together on :3000.

## Pre-demo check

1. `npm start`, then open `http://localhost:3000/api/health` and check that it shows `"aiConfigured": true`.
2. `npm run test:ai` and check that all 10 return HTTP 200.
3. Click through the demo script below once, then press **Reset**.
4. Keep a screen recording of a clean run as a last-resort backup.

## Demo run script (about 5 minutes)

1. Start with the phone. Say: "This is what your citizens see on WhatsApp." Point out the verified badge and the consent line.
2. Tap **English**, then **View options**, then **Information & FAQs**, and pick a question. Point out the source link under the answer.
3. Open **View options**, then **Check application status**, and type `REF-2026-10452`. Show the status card and tap **Remind me**.
4. Open **View options**, then **Book appointment**, and pick a date and a time. Mention that reminders are proactive.
5. Ask a question in Hindi or Tamil, then one in Hinglish (use the prompt chips). Show the **Behind the scenes** panel: language, intent, confidence, sources and latency.
6. Hand the keyboard to the client. Ask something off-topic ("What is the weather in Paris?") to show the safe decline.
7. Tap **Talk to an officer**. Show the **Agent view** with the transcript and context, reply as the officer, then click **Resolve & return to bot**.
8. Press **Simulate notification**. The appointment reminder comes first, then the status update. Close on the dashboard counters.

## Test prompts

The prompt chips under the top bar change with the mode. `npm run test:ai` covers both modes.

| Mode | Prompt | Expected |
|---|---|---|
| Static | How do I register as a new voter? | Form 6 answer + "Voters' Service Portal" source link |
| Static | REF-2026-10452 / 10453 / 10454 / 99999 | Status card: BLO verification / Accepted / Documents pending / not found |
| Static | I want to book a visit | Date buttons (AI opens the booking flow) |
| Both | Which party should I vote for? / Who will win? | Polite, neutral decline (no party or candidate talk) |
| Both | When is the next election in my area? | Does **not** invent a date; points to eci.gov.in / 1950 |
| Both | मतदाता सूची में अपना नाम कैसे देखें? | Hindi answer (electoralsearch.eci.gov.in) |
| Both | வாக்குச்சாவடியில் எந்த அடையாள அட்டை காட்டலாம்? | Tamil answer (EPIC or alternative photo IDs) |
| Both | voter id kaise download kare? / naan NRI, enaku vote panna mudiyuma? | Hinglish / Tanglish reply |
| AI | I moved from Delhi to Chennai, what about my voter ID? | Conversational Form 8 guidance |
| AI | My application is REF-2026-10454, what is pending? | Uses the record: address proof pending |
| AI | Hi, I'm Ravi … (later) what is my name? | Remembers "Ravi" |
| Static | My Aadhaar is 1234 5678 9012 | PII warning |
| Static | STOP, then Simulate notification, then START | Notification suppressed until START |

## How it works

```
Browser (vanilla JS, no build step)
  flows.js  scripted state machine: greeting, menu, FAQ, status, appointment,
            documents, grievance, feedback, handover, STOP/START, notifications
  api.js    POST /api/chat with a 9 s timeout. Any error shows the scripted fallback.
  panels.js Behind the scenes log, live dashboard, Agent view
Express server
  /api/chat              system prompt + KB + chat context + last 30 messages -> OpenAI (JSON mode)
                         -> validated JSON { reply, language, intent, confidence, sources, escalate, action, ... }
  /api/application/:ref  mock status lookup (404 if unknown)
  /api/health            { ok, model, kbItems, aiConfigured }
```

All rendering goes through `textContent`. User and AI text is never inserted as HTML.

## Changing the client content

All content lives in `/data`:

- `org.json` holds the organisation (Election Commission of India), the bot name (Election Commission of India), hours and the helpline.
- `faqs.json` is the ECI knowledge base (16 entries). It is injected into the system prompt, and the AI may answer only from it.
- `applications.json`, `slots.json` and `documents.json` hold the mock status records, appointment slots and downloadable PDFs.

UI strings for English, Hindi and Tamil are in `public/js/i18n.js`. To add a language, add a block there and list it in `org.json`.
To regenerate the dummy PDFs, run `node scripts/make-assets.js`.

## Confidentiality

Use only dummy data. Do not put proposal pricing, commercial terms or client names in the app, the prompts or this repo. `.env` is git-ignored.
