WhatsApp AI Chatbot Demo
Build Specification for Claude Code
Hybrid demo: scripted flows + live AI answers
Item
Detail
Purpose
Client-facing demo of the WhatsApp AI Bot described in section 1.5 of the PivotRoots AI Conversational Platform proposal (Sept 2026, v1.0).
Audience for this doc
Claude Code (the CLI agent) as the builder, and the developer supervising it.
Deliverable
A web app: phone mockup with a WhatsApp-style chat, a small Node.js backend, and demo-control panels.
Status
Draft v1.0. Sector and final language list still to be confirmed (see section 2).
Confidentiality
The source proposal is confidential. Never put its pricing or commercial terms in the demo or the repo.
0. How to Use This Document with Claude Code
Create the repo: make an empty folder, run git init, and save this document as docs/SPEC.md (or paste the relevant sections).
Add CLAUDE.md: copy the template in Appendix A to the repo root so Claude Code loads the rules in every session.
Start Claude Code in the repo folder with claude. For each phase in section 14, use plan mode first, review the plan, then let it implement.
Work phase by phase. Paste one phase prompt at a time, test it in the browser, commit, then move on. Use /clear between phases so context stays small.
Keep this spec as the source of truth. If a decision changes, update the spec, not just the code.
1. Project Overview
The proposal promises a WhatsApp AI Bot that gives users 24x7 self-service on the app they already use: natural-language answers in English, Hindi and regional languages, interactive menus and buttons, document sharing, status look-ups, proactive notifications, and human handover. This demo must make those promises visible to a client in about five minutes, without needing a Meta Business account or a real phone number.
1.1 Goals
Show the end-to-end experience of the WhatsApp AI Bot inside a realistic phone mockup in the browser.
Prove the "single brain" idea: answers come only from an approved knowledge base, with a safe fallback.
Let the client type anything and get a sensible reply (live AI), while the main journeys stay 100% reliable (scripted).
Expose the "AI core" visually through a Behind the Scenes panel and a mini analytics strip.
1.2 Non-Goals
No real WhatsApp, Meta, BSP, telephony or voice integration.
No production authentication, database or multi-user support.
No real client data and no real integrations with the client’s systems; all data is dummy.
Not a pixel-perfect clone of WhatsApp; use a WhatsApp-style look without the official logo or branding.
2. Assumptions and Open Items
Topic
Working assumption
Status
Client sector
Neutral public-service / admissions style organisation, branded "Sample Institute". Content lives in config and JSON files so it can be swapped in minutes.
Open: confirm the real sector
Languages
English, Hindi, Tamil. Hinglish input must work. Architecture allows adding more by editing prompts and content only.
Open: confirm list
LLM
Claude API, model claude-haiku-4-5-20251001 for low latency and cost. Model name set via env var.
Decided: hybrid approach
Hosting
Runs locally on the presenter’s laptop for the meeting. Optional deploy to Vercel/Render as a backup link.
Decided
Knowledge base
About 15 dummy FAQs, 3 dummy applications, 2 dummy PDFs, appointment slots. Injected into the system prompt (no vector DB).
Decided
Branding
Neutral WhatsApp-style palette; bot name "Sample AI Helpdesk". No PivotRoots pricing anywhere.
Decided
3. Scope Mapped to the Proposal
Proposal feature (section 1.5)
How the demo shows it
Priority
Verified business presence
Verified badge in chat header and a "Verified business account" note.
Must
Natural-language chat, multilingual
Live AI reply in the user’s language; language buttons on greeting.
Must
Menus, quick replies, list messages
Greeting menu, quick-reply buttons, and a list-message bottom sheet.
Must
Documents, images, links
Document card (PDF), link preview card, one image message.
Must
Real-time status look-up
Application reference number returns a status card from mock data.
Must
Appointments
Slot picker with buttons, confirmation, and a later reminder.
Should
Proactive template notifications
"Simulate notification" button pushes a template-style message.
Must
Human handover with context
Escalation message plus a side panel showing the agent view with the transcript.
Must
Opt-in / opt-out and consent
First-message consent prompt and "STOP" keyword handling.
Should
Feedback survey
Rating buttons after a resolved conversation.
Should
Guardrails, approved knowledge only
Out-of-scope question gets a polite decline and officer offer.
Must
4. Architecture and Tech Stack
Browser (index.html, vanilla JS + CSS)
  |-- Phone UI  (chat, bubbles, buttons, list sheet, cards)
  |-- Scripted flow engine (state machine, local JSON data)
  |-- Behind-the-scenes panel + mini dashboard + control bar
  |
  |  fetch POST /api/chat   (free-typed text only)
  v
Node.js + Express backend
  |-- /api/chat   -> builds prompt (system + KB + history) -> Claude API
  |-- /api/application/:ref -> mock status lookup
  |-- /api/health
  |-- Timeout, validation, rate limit, structured JSON output
  v
Claude API (Messages endpoint)  -- returns JSON: reply, intent, language, ...

Layer
Choice
Frontend
Single page: index.html + styles.css + app.js (ES modules). Vanilla JS, no build step. Inline SVG icons. Google Fonts: Inter or system font, Noto Sans Devanagari, Noto Sans Tamil.
Backend
Node.js 20+, Express, dotenv, cors, express-rate-limit, @anthropic-ai/sdk.
LLM
Claude API, model from CLAUDE_MODEL env var (default claude-haiku-4-5-20251001), max_tokens about 500, low temperature.
Data
Static JSON files in /data. No database.
Hosting
Local first (npm start). Optional Vercel/Render deploy with env vars set in the dashboard.
5. Repository Structure
whatsapp-ai-demo/
  CLAUDE.md                  # rules for Claude Code (Appendix A)
  README.md                  # how to run + demo script
  .env.example               # ANTHROPIC_API_KEY, CLAUDE_MODEL, PORT
  .gitignore                 # node_modules, .env
  package.json
  docs/
    SPEC.md                  # this document
  server/
    index.js                 # Express app, routes, static hosting
    llm.js                   # Claude call, prompt builder, JSON parsing
    prompt.js                # system prompt template
    kb.js                    # loads KB + applications from /data
    fallback.js              # scripted fallback replies per language
  public/
    index.html
    css/styles.css
    js/app.js                # bootstrap, event wiring
    js/chat.js               # rendering bubbles, typing, ticks
    js/flows.js              # scripted state machine
    js/api.js                # fetch wrapper with timeout + fallback
    js/panels.js             # behind-the-scenes, dashboard, controls
    js/i18n.js               # UI strings en/hi/ta
    assets/                  # sample.pdf, sample-image.jpg, icons
  data/
    org.json                 # org + bot name, colours, hours
    faqs.json
    applications.json
    slots.json
    documents.json
6. Functional Requirements
ID
Requirement
Priority
Phase
FR-01
Display a phone mockup with status bar, chat header (bot name, verified badge, "online"), message area and input bar.
Must
1
FR-02
Render incoming and outgoing bubbles with timestamps and ticks (sent, delivered, read) and a date chip.
Must
1
FR-03
Show a typing indicator and a 0.6–1.4 s delay before bot replies.
Must
1
FR-04
Support quick-reply buttons attached to a bot bubble; tapping one sends it as a user message.
Must
2
FR-05
Support a list message: a button opens a bottom sheet with selectable rows.
Must
2
FR-06
Support document card (name, size, PDF icon, download link), link preview card and image message.
Must
2
FR-07
Scripted flows: greeting + language select, FAQ menu, application status, appointment booking, grievance registration, feedback.
Must
2
FR-08
Detect an application reference (REF-YYYY-NNNNN) and show a status card from mock data; unknown refs get a friendly not-found reply.
Must
2
FR-09
Any free-typed message not matched by a flow goes to POST /api/chat and the reply is rendered like any other bubble.
Must
3
FR-10
AI replies must be grounded in the knowledge base; out-of-scope questions get a polite decline and an offer to connect to an officer.
Must
3
FR-11
Reply in the user’s language (English, Hindi, Tamil, Hinglish) with automatic detection.
Must
3, 5
FR-12
Behind the Scenes panel shows per-reply language, intent, confidence, sources and latency.
Must
4
FR-13
Mini dashboard strip shows conversations, resolved %, escalations and top intents, updating live.
Should
4
FR-14
Escalation: "Talk to an officer" shows a handover message and opens an Agent view panel with the full transcript and detected context.
Must
4
FR-15
Control bar: Reset, language switch, Simulate proactive notification, prompt chips, show/hide panels.
Must
4
FR-16
Consent prompt on first message and handling of STOP / opt-out.
Should
2
FR-17
If the API call fails or exceeds 8 s, show a scripted fallback reply in the active language and flag it in the panel.
Must
6
FR-18
Responsive: full-screen on small devices with panels hidden; centered phone with side panels on desktop.
Should
7
7. UI Specification
7.1 Layout
Desktop (1280px and up): three columns. Left: Behind the Scenes panel. Center: phone (about 390 x 800 px). Right: Agent view and mini dashboard. A control bar sits above or below the phone.
Tablet / small: phone is centered; panels collapse into tabs under the phone.
Mobile: phone frame is removed; chat goes full-screen; panels hidden behind a small menu.
7.2 Design Tokens
Token
Value
Use
--wa-teal-dark
#075E54
Header background, headings
--wa-green
#128C7E
Accents, links, buttons
--wa-out-bubble
#D9FDD3
Outgoing (user) bubble
--wa-in-bubble
#FFFFFF
Incoming (bot) bubble
--wa-chat-bg
#EFE7DE
Chat wallpaper (subtle pattern optional)
--wa-tick-read
#53BDEB
Read ticks
--font-main
Inter, system-ui
Latin text; add Noto Sans Devanagari and Noto Sans Tamil for scripts
7.3 Components
Component
Behaviour
Phone frame
Rounded bezel, notch, status bar (time, signal, battery), home indicator. Pure CSS.
Chat header
Back arrow, avatar, bot name, verified badge, "online" or "typing...", icons.
Bubble
Max width about 78%; tail on first bubble of a group; timestamp and ticks bottom-right; supports bold and links.
Quick replies
Up to 3 buttons under a bubble, full-width, teal text, divider lines; disabled after use.
List message
A "View options" button opens a bottom sheet with a titled list of rows (title + description); selecting a row sends it.
Document card
PDF icon, file name, size, pages, and a Download action pointing to /assets/sample.pdf.
Status card
Structured card: reference no., applicant (dummy), status chip (colour-coded), last updated, next step.
Link preview
Title, short description, domain; opens in a new tab.
Typing indicator
Three animated dots in an incoming bubble.
System note
Centered grey chip, e.g. "Chat transferred to an officer".
Input bar
Emoji, text input, attach, and send/mic toggle. Enter sends. The user may type while the bot is still "typing".
8. Conversation Flows
Scripted flows run entirely in the browser using local JSON and the flow state machine. Anything not matched goes to the live AI. Button payloads are stable IDs so tapping a button never depends on text matching.
Flow
Trigger
Bot behaviour
Components
Greeting + consent
First load or Reset
Consent line, welcome, language buttons (English / हिन्दी / தமிழ்), then main menu.
Quick replies
Main menu
After language, or "menu"
List message: Information & FAQs, Check application status, Book appointment, Get documents, Register grievance, Talk to an officer.
List message
FAQ
Menu row or typed question
Top FAQ topics as list; answer with source link. Free-typed FAQs go to AI.
List, link preview
Application status
Menu row or REF number typed
Ask for reference, validate format, show status card, offer "Remind me" and "Talk to an officer".
Status card, quick replies
Appointment
Menu row
Date buttons, then time buttons, then confirmation; later a reminder bubble after Simulate.
Quick replies
Documents
Menu row
Document list; selecting sends a PDF card.
List, document card
Grievance
Menu row
Collects a short description, returns ticket ID (e.g. GRV-2026-0042) and expected time.
Text input, quick replies
Feedback
After resolution
"Was this helpful?" with Yes / No; star rating optional; thanks.
Quick replies
Human handover
Button, keyword, or low confidence
Handover message, system note, Agent view opens with transcript, intent and language.
System note, side panel
Proactive notification
Control bar button
Template-style message: "Update: your application REF-2026-10452 status changed to Approved." with a View details button.
Template bubble, button
Opt-out
User types STOP
Confirms opt-out; further proactive messages suppressed until "START".
Text
8.1 Sample Script (English)
Bot : Hello! I am the Sample AI Helpdesk. By continuing you agree to receive
      service messages. Choose your language:   [English] [हिन्दी] [தமிழ்]
User: English
Bot : How can I help you today?   [View options]
User: Check application status
Bot : Please share your application reference number.
User: REF-2026-10452
Bot : [Status card] REF-2026-10452 | Under review | Updated 03 Oct 2026
      We will notify you here as soon as it is updated.
      [Remind me] [Talk to an officer]
User: Which documents do I need to apply?
Bot : (live AI) You will need identity proof, address proof and a recent
      photograph. Source: Application Guidelines (PDF)
User: What is the weather in Paris?
Bot : (live AI, guardrail) I can only help with Sample Institute services.
      Would you like to speak to an officer?   [Talk to an officer]
8.2 Languages
UI strings for buttons, menus, consent and fallback replies live in i18n.js for en, hi and ta.
The live AI replies in the language of the user’s last message; if the message is Hinglish, reply in simple Hindi or Hinglish matching the user.
The language buttons set the default language for scripted flows; the AI may still switch if the user switches mid-chat.
9. Backend API Specification
Endpoint
Method
Purpose
/api/chat
POST
Free-text message to the AI. Returns a structured reply.
/api/application/:ref
GET
Mock status lookup from data/applications.json. 404 if not found.
/api/health
GET
Returns { ok: true, model, kbItems } for pre-demo checks.
/ (static)
GET
Serves /public.
9.1 POST /api/chat
Request body:
{
  "message": "Which documents do I need?",
  "history": [ { "role": "user", "content": "..." }, { "role": "assistant", "content": "..." } ],
  "language": "en"
}

Success response (the model is instructed to return only this JSON):
{
  "reply": "You will need identity proof, address proof and a recent photograph.",
  "language": "en",
  "intent": "faq",
  "confidence": 0.93,
  "sources": ["faq_documents_required"],
  "escalate": false,
  "suggested_replies": ["Eligibility", "Office timings"],
  "latency_ms": 1180
}

intent values: faq, status, appointment, document, grievance, feedback, handover, out_of_scope, smalltalk.
language values: en, hi, ta (plus "mixed" for Hinglish).
Errors: 400 for invalid input (empty or over 500 characters); 429 when rate-limited; 502/504 for LLM failure or timeout. The frontend treats any non-200 as a trigger for the scripted fallback.
Safeguards: trim history to the last 8 turns, cap message length, 8 s server timeout, express-rate-limit (for example 30 requests/minute/IP), never log the API key.
10. LLM Integration and Guardrails
10.1 Prompt Assembly
System prompt (template below) with org name, bot name, languages and working hours filled from org.json.
Knowledge base block: all FAQs from faqs.json as numbered entries with IDs.
Conversation history (last 8 turns) as messages, then the new user message.
Parse the model output as JSON (strip code fences if present). If parsing fails, retry once; if it still fails, use the fallback reply.
10.2 System Prompt Template
You are {{bot_name}}, the WhatsApp assistant for {{org_name}}.
Answer ONLY using the KNOWLEDGE BASE below. Do not use outside knowledge.
 
RULES
1. If the answer is not in the knowledge base, say you do not have that
   information and offer to connect the user to an officer. Set
   intent="out_of_scope" and escalate=false unless the user asks for a human.
2. Reply in the same language as the user's last message (English, Hindi,
   Tamil). For Hinglish, reply in simple Hindi or Hinglish.
3. Keep replies short (max 60 words), friendly, WhatsApp style. Plain text,
   *bold* allowed. No markdown headings or tables.
4. Never ask for or repeat sensitive data (passwords, OTPs, full ID numbers).
5. Refuse abuse, politics, medical/legal advice and anything unrelated to
   {{org_name}} services. Be polite and offer an officer.
6. If the user asks for a human, is angry, or confidence is below 0.5,
   set escalate=true.
7. Output ONLY valid JSON with keys: reply, language, intent, confidence,
   sources, escalate, suggested_replies (max 3, short). No extra text.
 
KNOWLEDGE BASE
{{faq_entries}}   // [faq_id] question -> answer
10.3 Guardrail Behaviours to Demonstrate
Topic restriction: "Who will win the match?" gets a polite decline.
No invention: asking for a fee that is not in the KB must not produce a made-up number.
PII caution: if the user types a long number that looks like an ID, the bot reminds them not to share sensitive details in chat.
Low confidence: replies below the threshold trigger an officer offer and mark the Behind the Scenes entry as "low confidence".
11. Knowledge Base and Mock Data
11.1 faqs.json (about 15 entries)
[
  {
    "id": "faq_documents_required",
    "category": "Applying",
    "question": "Which documents are required to apply?",
    "answer": "Identity proof, address proof and a recent photograph.",
    "source": "Application Guidelines (PDF)",
    "url": "/assets/sample.pdf"
  }
]

Suggested FAQ topics: eligibility, documents required, how to apply, last date, fee and payment methods, office timings, holidays, contact details, track application, correct a mistake in application, download certificate, scholarships, grievance process, appointment rules, data privacy. Provide each in English; the AI translates on the fly.
11.2 applications.json
Reference
Status
Updated
Next step
REF-2026-10452
Under review
03 Oct 2026
We will notify you here when updated
REF-2026-10453
Approved
01 Oct 2026
Download your certificate
REF-2026-10454
Documents pending
28 Sep 2026
Upload address proof

11.3 Other Data Files
slots.json : next 5 working dates with morning and afternoon slots.
documents.json : 3 downloadable items (application form, guidelines, fee structure) pointing to dummy PDFs.
org.json : orgName, botName, working hours, brand colours, default language, support phone (dummy).
12. Configuration
# .env.example
ANTHROPIC_API_KEY=your_key_here
CLAUDE_MODEL=claude-haiku-4-5-20251001
PORT=3000
LLM_TIMEOUT_MS=8000
RATE_LIMIT_PER_MIN=30

The API key must live only in .env on the server and must never be sent to the browser or committed to Git. Add a spending limit to the key in the Anthropic console before the demo.
13. Reliability, Fallback and Security
13.1 Fallback Strategy
Frontend timeout of 8 s on /api/chat; on timeout or error, show the scripted fallback for the active language ("Let me connect you to an officer") and add a "fallback used" tag in the Behind the Scenes panel.
Offline mode: a ?offline=1 URL flag disables the AI and uses only scripted flows plus a few canned answers, for use when Wi-Fi is unreliable.
Pre-demo check: /api/health plus one test message; keep a screen recording of a perfect run as a last-resort backup.
13.2 Security and Confidentiality
Only dummy data in the repo; no real client names, numbers or documents.
No proposal pricing, commercial terms or confidential text inside the app, prompts or README.
.env in .gitignore; rotate the API key after the demo if it was shared on any screen.
Sanitise rendered text (escape HTML) so user input and AI output cannot inject markup.
14. Build Plan and Claude Code Prompts
Run one phase at a time. For each phase: start in plan mode, review the plan, approve, test in the browser, then commit with a clear message. The prompts below are written to be pasted directly.
Phase
Focus
Rough effort
Done when
0
Project setup
15 min
npm start serves a hello page; health route works
1
Phone UI shell
1–2 hrs
Static chat looks like WhatsApp with sample bubbles
2
Scripted flows
2–3 hrs
Full scripted journey works with no backend
3
Backend + live AI
1–2 hrs
Free-typed questions answered from the KB
4
Panels + dashboard + handover
2 hrs
Behind the Scenes, Agent view and counters live
5
Multilingual
1 hr
EN/HI/TA work in UI strings and AI replies
6
Hardening and fallback
1 hr
Timeouts, offline mode, error cases handled
7
Polish and rehearsal
1–2 hrs
Responsive, animations, README, full dry run

Phase 0: Setup
Read docs/SPEC.md and CLAUDE.md. Initialise a Node.js project (Express, dotenv,
cors, express-rate-limit, @anthropic-ai/sdk). Create the folder structure from
section 5, .env.example, .gitignore, and a server that serves /public and
exposes GET /api/health. Add npm scripts "start" and "dev". Do not build UI yet.
Phase 1: Phone UI shell
Build public/index.html, css/styles.css and js/chat.js per sections 7.1-7.3.
Vanilla JS only. Create a phone frame, chat header, message area and input bar.
Implement renderBubble(), typing indicator, ticks, date chip and system note.
Seed a few static sample messages to verify the look. Use CSS variables from
section 7.2. Include Noto Sans Devanagari and Noto Sans Tamil fonts.
Phase 2: Scripted flows
Implement js/flows.js as a state machine for the flows in section 8, using
data/*.json (create the dummy data per section 11). Add quick replies, the
list-message bottom sheet, document card, status card, link preview, consent,
STOP/START handling and the Simulate notification hook. No backend calls yet.
Phase 3: Backend and live AI
Implement server/llm.js, prompt.js, kb.js and POST /api/chat per sections 9-10.
Use the model from CLAUDE_MODEL. Return the JSON schema exactly. Add history
trimming, input validation, 8s timeout, rate limiting and JSON-parse retry.
Wire js/api.js so unmatched free text calls /api/chat and renders the reply.
Phase 4: Panels, dashboard, handover
Implement js/panels.js: Behind the Scenes (language, intent, confidence,
sources, latency, fallback flag), mini dashboard counters, Agent view with
transcript on handover, and the control bar (Reset, language switch, Simulate
notification, prompt chips, panel toggles). Follow FR-12 to FR-15.
Phase 5: Multilingual
Complete js/i18n.js for en, hi, ta. Make all scripted text, buttons and menus
language-aware. Verify the AI replies in the user's language including Hinglish.
Add test prompts for each language to the README.
Phase 6: Hardening and fallback
Implement the scripted fallback (server/fallback.js and frontend), ?offline=1
mode, HTML escaping of all rendered text, and clear error handling. Add a
script that sends 10 test questions to /api/chat and prints intent/latency.
Phase 7: Polish and rehearsal
Make the layout responsive per section 7.1, tune animations and delays, write
the README with run steps and the demo script from section 16, and fix any
issues from the acceptance checklist in section 15. Do not add new features.
15. Testing and Acceptance Checklist
#
Check
Result
1
App starts with npm start and loads at localhost:3000 with no console errors.

2
Greeting, consent and language buttons work; main menu list opens as a bottom sheet.

3
REF-2026-10452 returns a status card; an unknown reference returns a friendly message.

4
Appointment flow completes and the reminder appears after Simulate.

5
Document request shows a PDF card that opens the sample file.

6
Free-typed FAQ ("What documents do I need?") returns a grounded answer with a source.

7
Out-of-scope question ("Weather in Paris?") is politely declined with an officer offer.

8
A fee not in the KB is NOT invented.

9
Hindi, Tamil and Hinglish questions are answered in the right language.

10
Talk to an officer triggers the handover note and Agent view with the transcript.

11
Behind the Scenes shows language, intent, confidence, sources and latency for each AI reply.

12
Dashboard counters update live; Reset clears chat, state and counters.

13
Disconnecting the network triggers the fallback within 8 s without breaking the UI.

14
?offline=1 mode works fully with scripted flows.

15
No API key in the browser, no confidential proposal content, .env not committed.

16. Demo Run Script (about 5 minutes)
Open with the phone alone. Say: "This is what your citizens see on WhatsApp." Show the verified badge and consent line.
Pick a language, open the menu list, and ask a FAQ. Point out the source link under the answer.
Check application status with REF-2026-10452. Show the status card, then tap Remind me.
Book an appointment with the buttons; mention reminders are proactive.
Ask a question in Hindi or Tamil, then in Hinglish. Open the Behind the Scenes panel to show detection and sources.
Hand the keyboard to the client and let them type anything. Show how an unknown topic is declined safely.
Tap Talk to an officer and show the Agent view with full context.
Press Simulate notification to show a proactive template message. Close on the dashboard counters.
17. Path from Demo to Production
The demo deliberately mirrors the production architecture so the client can see the road ahead:
Demo element
Production equivalent
Browser phone UI
Official WhatsApp Business Platform via Meta or an authorised BSP, with webhook-based message handling.
Static JSON knowledge base in the prompt
Managed knowledge base with RAG over uploaded PDFs, web pages and FAQs, editable from the Admin Dashboard.
Mock status lookup
REST integration with the client’s existing portals, CRM or case-management systems.
Agent view panel
Human Escalation Console with routing by department, language and working hours.
Mini dashboard strip
Full Admin Dashboard & Analytics with reports and audit trail.
Local laptop hosting
India-region cloud hosting, encryption, role-based access and DPDP-aligned data practices.
Appendix A: CLAUDE.md Template
Save this as CLAUDE.md in the repository root.
# Project: WhatsApp AI Chatbot Demo
 
Client-facing demo of a WhatsApp AI bot (hybrid: scripted flows + live AI).
Source of truth: docs/SPEC.md. Follow it; if something conflicts, ask me.
 
## Stack
- Frontend: vanilla JS + CSS in /public, no build step, no frameworks.
- Backend: Node 20+, Express, @anthropic-ai/sdk in /server.
- Data: static JSON in /data. No database.
 
## Rules
- Work one phase at a time (SPEC section 14). Do not build ahead.
- Never expose ANTHROPIC_API_KEY to the browser. Never commit .env.
- Dummy data only. No confidential proposal content or pricing anywhere.
- Escape all rendered text (no raw innerHTML with user or AI content).
- AI must answer only from the knowledge base and return the JSON schema
  in SPEC section 9.1. Keep replies under 60 words.
- Keep functions small and files in the structure from SPEC section 5.
 
## Commands
- npm run dev   : start with auto-reload
- npm start     : production-style start
- npm run test:ai : send sample questions to /api/chat and print results
 
## Definition of done for each phase
- Runs without console errors, matches the SPEC requirement IDs, and is
  committed with a clear message.

Before you start
Confirm the client’s sector and language list, then update data/org.json, data/faqs.json and the language list in section 2. Everything else in this spec stays the same.
