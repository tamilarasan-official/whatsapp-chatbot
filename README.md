# WhatsApp AI Chatbot Demo

A client-facing demo of a WhatsApp-style AI helpdesk for **Sample Institute** (dummy organisation).
It is a hybrid: the main journeys are scripted so they never fail, and anything free-typed goes
to Claude, which answers only from an approved knowledge base.

No WhatsApp, Meta or phone number is needed. Everything runs locally in the browser.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env        # then put your key in ANTHROPIC_API_KEY
npm start                   # http://localhost:3000
```

- `npm run dev` restarts on file changes.
- `npm run test:ai` sends 10 sample questions to `/api/chat` and prints intent, language, confidence and latency (server must be running).
- `http://localhost:3000/?offline=1` turns off the AI and uses scripted flows plus keyword-matched FAQ answers. Use it if the Wi-Fi is unreliable.

Without an API key the app still runs. Free-typed questions get the scripted fallback ("Let me connect you to an officer"), and the top bar shows an "AI not configured" badge.

### Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Claude API key. Stays on the server and is never sent to the browser. |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | Model used for live answers |
| `PORT` | `3000` | HTTP port |
| `LLM_TIMEOUT_MS` | `8000` | Server-side LLM timeout |
| `RATE_LIMIT_PER_MIN` | `30` | Requests per minute per IP on `/api/chat` |

Set a spending limit on the key in the Anthropic console before the demo. Rotate the key afterwards if it was shown on screen.

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

| Language | Prompt | Expected |
|---|---|---|
| English | What documents do I need? | Grounded answer + "Application Guidelines (PDF)" source |
| English | What is the application fee amount? | Says it does not have the amount and offers an officer. No invented number. |
| English | What is the weather in Paris? / Who will win the match? | Polite decline + officer button (guardrail) |
| Hindi | आवेदन की अंतिम तिथि क्या है? | Answer in Hindi (31 Oct 2026) |
| Hindi | छात्रवृत्ति के बारे में बताइए | Answer in Hindi |
| Tamil | அலுவலக நேரம் என்ன? | Answer in Tamil (Mon–Fri, 9:30–5:30) |
| Tamil | விண்ணப்பிக்க என்ன ஆவணங்கள் தேவை? | Answer in Tamil |
| Hinglish | mujhe scholarship ke baare mein batao | Reply in Hinglish, language = mixed |
| Hinglish | last date kya hai apply karne ki? | Reply in Hinglish |
| Any | My Aadhaar is 1234 5678 9012 | PII warning (scripted, never sent to the AI) |
| Any | REF-2026-10453 / REF-2026-10454 / REF-2026-99999 | Approved / Documents pending / Not found |
| Any | STOP, then Simulate notification, then START | Notification is suppressed until START |

## How it works

```
Browser (vanilla JS, no build step)
  flows.js  scripted state machine: greeting, menu, FAQ, status, appointment,
            documents, grievance, feedback, handover, STOP/START, notifications
  api.js    POST /api/chat with an 8 s timeout. Any error shows the scripted fallback.
  panels.js Behind the scenes log, live dashboard, Agent view
Express server
  /api/chat              system prompt + KB + last 8 turns -> Claude -> validated JSON
  /api/application/:ref  mock status lookup (404 if unknown)
  /api/health            { ok, model, kbItems, aiConfigured }
```

All rendering goes through `textContent`. User and AI text is never inserted as HTML.

## Changing the client content

All content is dummy and lives in `/data`:

- `org.json` holds the organisation name, bot name, hours and contact details.
- `faqs.json` is the knowledge base (15 entries). It is injected into the system prompt, and the AI may answer only from it.
- `applications.json`, `slots.json` and `documents.json` hold the mock status records, appointment slots and downloadable PDFs.

UI strings for English, Hindi and Tamil are in `public/js/i18n.js`. To add a language, add a block there and list it in `org.json`.
To regenerate the dummy PDFs, run `node scripts/make-assets.js`.

## Confidentiality

Use only dummy data. Do not put proposal pricing, commercial terms or client names in the app, the prompts or this repo. `.env` is git-ignored.
