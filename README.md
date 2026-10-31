# State Election Commission, Bihar: WhatsApp AI Help Desk Demo

A client demo of a WhatsApp-style help desk for the **State Election Commission, Bihar**
(राज्य निर्वाचन आयोग, बिहार), covering Panchayat and Municipal elections. Answers come from the
Commission's official FAQs (68), the Bihar Panchayat Raj Act 2006, its 2021 amendment, the Bihar
Municipal Act 2007 and the eVoting case study. Complaint records are **dummy demo data**.
This is a demo built for SEC Bihar. The avatar is the emblem from the Commission's official profile, used with the client's authorisation (31 Oct 2026).

A switch in the top bar selects one of two chatbot types:

| Mode | How it behaves |
|---|---|
| **Static Chatbot** | Guided WhatsApp journeys in Hindi (default), English or Tamil: consent, language buttons, a main menu (Panchayat · Municipal · eVoting SECBHR app · Voter list · Nomination · Complaints · Acts · For election officials · Talk to an officer), official FAQ lists, complaint registration and status cards, Act PDFs, notifications and officer handover. Free-typed text goes to the answer engine. |
| **✦ AI Chatbot** | The user drives the conversation; every reply comes from the answer engine (our search model + OpenAI). It follows the user's language (Hindi, English, Tamil, Hinglish, Tanglish), cites the FAQ or Act section it used, stays politically neutral, and hands over to an officer when asked. |

The mode is kept in the URL (`?mode=static` / `?mode=ai`).

## Run it

Requires Node.js 20 or newer. The search model (`data/kb/index/model/`, 118 MB) is git-ignored; build it
with `scripts/kb` (see `scripts/kb/README.md`) or copy it in before starting.

```bash
npm install
cp .env.example .env        # then put your key in OPENAI_API_KEY
npm start                   # http://localhost:3000
```

- `npm run dev` restarts on file changes.
- `npm run test:ai` sends 16 sample questions to `/api/chat` and prints route, citations, language and latency.
- `npm run test:kb` runs the full accuracy test (Phase 5) and writes `docs/accuracy-report.html`.
- `node scripts/verify-node-search.js` checks the search model ranks exactly as in the Phase 2 evaluation.
- `npm run test:wa` tests the WhatsApp channel offline: every scripted flow, Cloud API limits, webhook signatures,
  de-duplication, rate limit and the officer API (no Meta account or OpenAI key needed).
- `http://localhost:3000/?offline=1` turns off the AI: scripted flows plus keyword-matched FAQ answers.

Without an API key the app still runs: questions that match an official FAQ get the official answer,
other free text gets the fallback ("I can connect you to an officer").

### Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | none | OpenAI API key. Stays on the server and is never sent to the browser. |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Model used for query rewriting and answers (reasoning effort: `OPENAI_REASONING_EFFORT`, default `low`) |
| `PORT` | `3000` | HTTP port |
| `LLM_TIMEOUT_MS` | `10000` | Server-side LLM timeout |
| `TRUST_PROXY` | `1` | Number of reverse proxies in front of the app (Dokploy/Traefik = 1) |
| `RATE_LIMIT_PER_MIN` | `30` | Requests per minute per IP on `/api/chat` |

## WhatsApp (real number)

The same backend serves the WhatsApp Cloud API: `GET/POST /webhook/whatsapp` receives Meta's webhooks and
`/api/whatsapp/admin/*` lets officers see the handover queue, reply, close and send complaint updates.
Without the `WHATSAPP_*` env vars the channel runs in dry-run mode (messages are logged). Going live is
configuration only: see **docs/WHATSAPP.md**.

```
Meta Cloud API ──webhook──> server/whatsapp/webhook.js  signature check, de-dupe, per-phone order + rate limit
                            server/session/engine.js    consent, language, menu, FAQ lists, complaints, Acts,
                                                        STOP/START, PII guard, officer handover, numbered picks;
                                                        free text -> server/answer.js (same engine as the web demo)
                            server/whatsapp/send.js     text / buttons (3) / lists (10 rows) / documents / templates,
                                                        bodies split and titles clipped to Meta's limits
                            server/session/store.js     per-number profile (language, STOP, complaints) in STATE_DIR;
                                                        conversations in memory, reset after 24 h idle
```

## How it works

```
Browser (vanilla JS, no build step)
  flows.js   scripted state machine: consent, language, menu, topic FAQ lists, complaints,
             Act PDFs, feedback, handover, STOP/START, notifications; citation cards under AI replies
  panels.js  Behind the scenes log (route, our model's match and score), dashboard, Agent view
Express server
  search.js  our fine-tuned multilingual-e5-small (int8 ONNX, runs in Node) over 68 FAQs and
             2,617 Act / case-study passages; direct "Section N" / "धारा N" lookup
  answer.js  route: section lookup -> official FAQ match -> Act passages -> chat
             Hinglish / follow-ups rewritten by the AI into Hindi + English queries first
             grounding checks: unknown citations dropped; numbers not in the sources or uncited
             facts -> one retry, then a safe reply
  /api/chat              -> { reply, language, intent, confidence, citations, route, search, ... }
  /api/complaint/:ref    dummy complaint lookup (CMP-2026-00412 / 00413 / 00414)
  /api/health            { ok, model, aiConfigured, kb }
```

All rendering goes through `textContent`. User and AI text is never inserted as HTML.
Only the top-level JSON files in `/data` are served to the browser; `data/kb` stays on the server.

## Content

- `data/org.json`: organisation and bot name (Hindi and English).
- `data/faqs.json`: the 68 official FAQs (Hindi + English), copied from `data/kb/faqs.json`.
- `data/menu.json`: the static main menu and which FAQs each topic lists.
- `data/documents.json` + `public/assets/docs/`: the Act PDFs.
- `data/complaints.json`: dummy complaint records.
- `data/kb/`: knowledge base and search index built by `scripts/kb` (see `docs/PLAN-SEC-BIHAR.md`).
- UI strings (Hindi, English, Tamil): `public/js/i18n.js`. Tamil FAQ text: `python scripts/kb/translate_faqs_ta.py` (IndicTrans2, offline; until it runs, FAQ taps in Tamil are answered by the AI in Tamil from the official FAQ).

## Deploy on Dokploy (Docker Compose, two domains)

| Domain | Service |
|---|---|
| https://valardemo.welocalhost.com | `frontend`: nginx serving the chat UI |
| https://apivalardemo.welocalhost.com | `backend`: Express API + search model + OpenAI |

See **[docs/DEPLOY.md](docs/DEPLOY.md)**. The backend needs about 500 MB of RAM (limit 1 GB) and the
model file must be available at build time (Phase 6).

## Demo run script (about 5 minutes)

1. Start with the phone: verified badge, consent line, Hindi/English buttons. Tap **हिन्दी**.
2. **विकल्प देखें → नामांकन और प्रत्याशी** → pick the age/fee question. Point out the official FAQ source card.
3. Type `ग्राम पंचायत का कार्यकाल कितने वर्ष का होता है?`: the answer cites *Panchayat Raj Act, Section 14*; tap the card to open the Act PDF at that page.
4. Type `CMP-2026-00412` for a complaint status card, then **Simulate notification** for the resolved update.
5. Switch to **✦ AI Chatbot** and use the chips: Hinglish, section lookup, eVoting, the case study.
   Show **Behind the scenes**: route, our model's match and score, query rewriting.
6. Ask `Who will win the panchayat election?` (neutral decline) and `How do I get a new voter ID card?` (redirect to ECI).
7. Tap **अधिकारी से बात करें**: Agent view with transcript, reply as the officer, then resolve.

## Confidentiality

Use only dummy records. Do not put proposal pricing or commercial terms in the app, the prompts or this repo. `.env` is git-ignored.
