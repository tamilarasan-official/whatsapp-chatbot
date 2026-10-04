# Project: WhatsApp AI Chatbot Demo

Client-facing demo of a WhatsApp AI bot (hybrid: scripted flows + live AI).
Source of truth: docs/SPEC.md. Follow it; if something conflicts, ask me.

## Stack
- Frontend: vanilla JS + CSS in /public, no build step, no frameworks.
- Backend: Node 20+, Express, openai SDK (OpenAI Chat Completions, JSON mode) in /server.
- Deploy: Dockerfile (Dokploy). Env vars set in Dokploy, never in the image.
- Data: static JSON in /data. No database.

## Rules
- Work one phase at a time (SPEC section 14). Do not build ahead.
- Never expose OPENAI_API_KEY to the browser. Never commit .env.
- Dummy data only. No confidential proposal content or pricing anywhere.
- Escape all rendered text (no raw innerHTML with user or AI content).
- AI must answer only from the knowledge base and return the JSON schema
  in SPEC section 9.1 (plus an `action` field). Keep replies under 60 words.
- The bot is conversational: greetings and small talk go to the AI; only
  buttons, REF numbers, STOP/START, PII and explicit officer requests are scripted.
- Keep functions small and files in the structure from SPEC section 5.

## Commands
- npm run dev   : start with auto-reload
- npm start     : production-style start
- npm run test:ai : send sample questions to /api/chat and print results

## Definition of done for each phase
- Runs without console errors, matches the SPEC requirement IDs, and is
  committed with a clear message.
