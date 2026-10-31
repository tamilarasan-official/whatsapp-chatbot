# Plan: State Election Commission, Bihar — WhatsApp Bot

Client: **State Election Commission, Bihar** (राज्य निर्वाचन आयोग, बिहार), which runs Panchayat and
Municipal (local body) elections. Replaces the ECI demo content.

Decisions (confirmed):
- Name: yes. Emblem: initially left out (neutral ballot box); on 31 Oct 2026 the client-side developer authorised the emblem from SEC Bihar's official profile as the avatar (public/assets/sec-bihar-emblem.png).
- Document processing (OCR, conversion, translation): **open-source, offline, no OpenAI**:
  Tesseract 5 (hin+eng) combined with EasyOCR; IndicTrans2 for Hindi -> English
- Search: small local embedding model (multilingual-e5-small, runs on the server); OpenAI only writes the final answer and does voice
- Officials-only Q&As: include, in their own "For election officials" section
- Voice bot: **not in this demo** (deferred; can be added later)

## Source documents (C:\Users\thami\Downloads\ECBHR)

| File | Content | Pages | Processing |
|---|---|---|---|
| ACT_Bihar Panchayat Raj Act 2006 - English.pdf | Panchayat Act (EN) | 166 | Text extract, split by section |
| ACT_Bihar Panchayat Raj Act 2006.pdf | Panchayat Act (HI) | 298 | Tesseract + EasyOCR (combined) → Unicode Hindi |
| AR-02-29-03-2007.pdf | Bihar Municipal Bill 2007 (HI, DevLys font) | 181 | DevLys/Kruti Dev → Unicode converter (OCR fallback) |
| The Bihar Municipal Act-2007( English).pdf | Municipal Act (EN) | 130 | Text extract, split by section |
| Gazette_674_9_8_2021.pdf | Panchayat Raj (Amendment) Act 2021 (HI only) | 4 | Tesseract + EasyOCR → Hindi; IndicTrans2 → English (human review) |
| Case Study - eVoting v0.2.pdf | Bihar's eVoting success story, ULB elections 2025 (EN, 56 pp, 96 images) | 56 | Chapters from text layer + Tesseract/EasyOCR on posters and app screenshots |
| FAQs.xlsx | Municipal FAQ 25, Panchayat FAQ 18 (EN+HI) | — | Normalise into faqs.json |
| nicci_response_format...xlsx | eVoting SECBHR app 16 + officials software rules 9 (EN+HI) | — | Normalise; audience = public / officials |

## Answer engine (no model training; retrieval + small FAQ matcher)

```
Question (Hindi / English / Hinglish / Bhojpuri)
 1. FAQ matcher: embedding similarity against 68 x 2 languages of questions
    -> close match: official SEC answer, verbatim, in the user's language (source: SEC Bihar FAQ)
 2. Act search: top sections of the Acts (EN + HI) -> gpt-4.1-mini answer that must cite
    "Act, Section" from the retrieved text only
 3. Nothing relevant: honest "I don't have that" + helpline / officer handover
```

## Phases

### Phase 1: Document processing (scripts/kb/, Python, run once, outputs committed)
1. Extract English Acts; split into chapter/section chunks with metadata (act, year, language, section no., title, page).
2. Convert AR-02 (DevLys 010) to Unicode Hindi; verify on sample pages; OCR fallback for pages that fail.
3. OCR the Hindi Panchayat Act (298 pages) and the 2021 Gazette: render 300 DPI (PyMuPDF), clean up (OpenCV),
   run Tesseract (hin+eng, tessdata_best) and EasyOCR (hi+en); per line keep the higher-confidence result,
   flag lines where the two disagree for review. Cached per page, resumable.
4. Translate the 2021 amendment to English with IndicTrans2 (offline); mark as "machine translation, pending review".
5. Merge the 3 FAQ sheets into data/kb/faqs.json (id, category, audience, q_en, a_en, q_hi, a_hi, keywords);
   strip "Q:" prefixes and title rows.
6. Quality report (HTML): sample pages original vs converted, section counts, flagged items for human check.

### Phase 2: Knowledge index
- Chunks of ~700 tokens, section-aware, small overlap. Embeddings: multilingual-e5-small (local, ~120 MB,
  Hindi + English, runs in Node via ONNX; no API cost). FAQ matcher uses the same model.
- Stored as data/kb/index.json, loaded into memory by the backend; cosine search in Node. No database.

### Phase 3: Answer engine (server)
- New server/kb.js (load index + FAQ), server/retrieve.js (FAQ match + section search), prompt rewritten for SEC Bihar.
- Response JSON adds `citations` [{type: faq|act, title, section, url}]; server rejects citations not in retrieved text.
- Guardrails kept: political neutrality, no invented dates/numbers, PII warning, "legal information, not legal advice".
- Languages: Hindi default, English, Hinglish; Bhojpuri/Maithili understood, replied in simple Hindi.
- Officials Q&As answered only when the question is about the software/ward-entry rules or the officials menu is used.

**Done.** As built:
- `server/search.js`: fine-tuned e5-small int8 ONNX via transformers.js (onnxruntime-node) + Phase 2 index; Node
  ranking verified identical to Python (`node scripts/verify-node-search.js`: FAQ test R@1 91.4%, section R@5 100%,
  0 out-of-scope accepted, ~9 ms/question). Direct lookup for "Section N" / "धारा N" / "dhara N" with Act hints.
- `server/answer.js`: routes lookup / faq / act / chat. Non-confident questions are rewritten by the AI into
  standalone Hindi + English queries (Hinglish, follow-ups). Score floors: FAQ 0.45, section 0.48, weak 0.40.
  eVoting topic words also pull in the eVoting FAQs (the model ranks generic "eVoting app" wording weakly).
- Grounding checks: unknown citation ids dropped; numbers not in the sources, or factual replies with no citation,
  get one corrective retry, then a safe reply (official FAQ text, or "I don't have that detail").
- No OpenAI key / AI failure: confident FAQ matches are answered with the official FAQ text.
- Response adds `citations` [{type faq|act|case_study, faq_id | act, section, title, page, reliability}], `route`, `search`.
- Reply language set by the server from the message (hi / en / Hinglish) and passed to the AI explicitly.
- Docker: backend image moved to node:20-bookworm-slim (onnxruntime-node needs glibc); memory limit 1 GB (~500 MB used).
- Known gaps for Phase 5: Hinglish FAQ R@1 69%; generic eVoting wording; add more training questions and re-fine-tune.

### Phase 4: Rebrand the demo
- Name "State Election Commission, Bihar" / "राज्य निर्वाचन आयोग, बिहार", neutral ballot-box avatar (no emblem), Hindi default.
- Language buttons: हिन्दी, English (Tamil removed).
- Menu: Panchayat elections · Municipal elections · eVoting SECBHR app · Voter list / e-Roll · Nomination & candidates ·
  Complaints · For election officials · Talk to an officer.
- Documents: the actual public Acts (EN/HI) as downloadable PDFs.
- Mock records: complaint status (e.g. CMP-2026-xxxxx), sample notification; home screen, prompt chips, client pack updated.
- Static and AI modes kept.

**Done.** As built: data/org.json, faqs.json (68 official FAQs), menu.json (9 menu items, FAQ lists paged 9 + "More"),
documents.json + public/assets/docs (5 Act PDFs), complaints.json (CMP-2026-00412/413/414, dummy); /api/complaint/:ref;
ballot-box avatar; Hindi default; citation cards under AI replies link to the Act PDF at the cited page;
officials menu sets audience=officials for the answer engine; only top-level /data/*.json served (data/kb never public).
Removed: Form 6/8, appointment booking, REF status, Tamil, ECI logo and sample PDFs.

### Phase 5: Accuracy testing
- ~120 questions: 68 FAQ paraphrases (HI/EN/Hinglish) + ~50 Act questions with expected section.
- `npm run test:kb` reports: FAQ hit rate, correct section cited, invented facts (target 0), language match.

**Done.** As built:
- Test set: 119 new hand-written questions (57 FAQ groups, 46 Act / case study, 16 out-of-scope & safety; 59 EN,
  31 HI, 29 Hinglish), checked automatically against overlap with the Phase 2 set and the training data
  (`scripts/kb/answer_tests.py` -> data/kb/eval/answer_tests.json). Never used for training.
- `npm run test:kb` (scripts/test-kb.js): runs the real answer engine; checks source cited, language, and an
  independent judge (gpt-5.5) matches every factual claim to a quoted source sentence (invented / meaning error,
  major or minor). Report: docs/accuracy-report.html; raw: data/kb/eval/answer_results.json.
- Fixes from the test: Hinglish detection + reply language set from the reply's script; officials FAQs need
  score >= 0.70 outside the officials menu; number check understands number words ("पाँच सौ" = 500); safe reply
  uses the FAQ text only at score >= 0.70; long uncited replies are retried; prompt keeps qualifiers.
- Search model v2: continued fine-tune (1 epoch) with train_extra.json (section-title queries from the Acts +
  hand-written Hinglish FAQ paraphrases) and BM25 fusion (w0.85). Node: FAQ test R@1 93.1% (Hinglish 69% -> 85%),
  section R@5 100%, 0 out-of-scope accepted; Phase 5 Act questions: right section in top 4 74% -> 83%.
  Matcher tau 0.515; score floors recalibrated (section 0.40, weak 0.36).
- Answer model: gpt-4.1-mini -> gpt-5.4-mini (reasoning effort low, one retry for stalled calls).
- Results (same strict judge): pass 76.5% -> 82.4%; meaning errors 27 -> 13; invented 8 -> 2; FAQ questions 94.7%;
  language 97.5%; out-of-scope/safety 93.8%; median 1.4 s, p90 2.9 s.
- Open: Act answers (63% pass) still lose legal qualifiers in ~1 in 4 answers; wrong section for ~15% of Act
  questions. Recommended: show the exact section text with each Act answer, and get the client's Election Rules.

### Phase 6: Deploy
- Same Dokploy compose (frontend + backend, same domains). Backend memory limit set to 1 GB in Phase 3. Model file (118 MB, git-ignored) fetched at build time.
- Optional: password-protect the demo link (government branding on a public URL).

### Phase 7: Client pack
- Demo guide PDF and WhatsApp message regenerated for SEC Bihar.

### Phase 8: WhatsApp go-live (real number, Meta WhatsApp Business Platform)
Status (1 Nov 2026): **code done (8.3); waiting on the client for 8.1 / 8.4 / 8.5.** The server hosts the whole
WhatsApp channel; going live needs only the `WHATSAPP_*` env values (docs/WHATSAPP.md). Longest lead items now:
Meta business verification and template approvals.
Open decision: direct Meta Cloud API vs an authorised BSP (Gupshup / Interakt / Twilio). A BSP costs more per
message but shortens onboarding and gives support; the webhook contract is nearly the same either way.
Items marked **(client)** need SEC Bihar to act or sign off.

#### 8.1 Meta accounts and approvals
- [ ] Meta Business Manager for the Commission, business verification done (registered name, address, government document). **(client)**
- [ ] WhatsApp Business Account under it; dedicated phone number not used in any WhatsApp app, reachable for SMS/voice OTP. **(client)**
- [ ] Display name approval ("State Election Commission, Bihar" / "राज्य निर्वाचन आयोग, बिहार").
- [ ] Official Business Account (green badge) application. Optional, expected for a government body.
- [ ] Channel decision: Cloud API direct or BSP. Payment method for conversation charges; who pays. **(client)**
- [ ] Message templates submitted per language (HI, EN): complaint update, reminder, re-engagement after the 24-hour window.
- [ ] Sandbox / test number for staging.

#### 8.2 Hosting and infrastructure
- [ ] India-region server or cloud project (current Dokploy box must be in India or move).
- [ ] Public HTTPS webhook URL (Dokploy + Let's Encrypt already give this).
- [ ] Datastore: Redis (sessions, rate limits) + Postgres (consent records, complaints, transcripts, analytics events).
      Replaces the demo's "no database" rule for production only; the demo stays file-based.
- [ ] OpenAI org with usage cap and a dedicated key; documented decision on sending citizen text to OpenAI
      (alternative: India-hosted model if the client requires in-country processing).
- [ ] Monitoring and alerts: webhook uptime, error rate, OpenAI failures, queue depth, memory.
- [ ] Datastore backups; deploy rollback path (Dokploy Deployments tab).

#### 8.3 Code to build (server/, new files)
**Done (1 Nov 2026)**; `npm run test:wa` = 35 offline checks. As built:
- [x] `server/whatsapp/webhook.js`: GET handshake; POST with X-Hub-Signature-256 (timing-safe), 200 before processing,
      message-id de-duplication (Meta retries), one ordered queue per phone, per-phone rate limit (20/min: one warning,
      then silence), failed-delivery statuses logged. Own JSON parser (raw body for the signature, 1 MB).
- [x] `server/whatsapp/send.js` + `limits.js` + `graph.js`: text / 3 reply buttons / lists (10 rows) / document /
      template / mark-read + typing indicator. Bodies over 1024 chars are split, titles clipped on grapheme boundaries
      (no broken matras), Graph API retries on 429/5xx, token never logged. Dry-run transport when no token.
- [x] `server/session/engine.js` + `strings.js`: full port of `public/js/flows.js` (consent, language, menu, FAQ lists
      with "More questions…", official FAQ answers, complaint register/status/remind, Act PDFs, feedback, STOP/START,
      PII guard, officer handover, officials audience, AI replies with citation line + PDF page link + suggestion
      buttons, AI actions menu/grievance/handover). WhatsApp additions: numbered rows + reply-by-number, first question
      answered right after language choice, welcome-back after 24 h idle, "text only" reply to media, handover expiry.
- [x] `server/session/store.js`: per-number profile (language, consent time, STOP, complaints, reminders) persisted to
      `STATE_DIR/whatsapp-profiles.json` (atomic, debounced; `wa-state` volume in compose); conversation and
      transcript in memory only, reset after `SESSION_TTL_MIN`. Swap for Redis/Postgres by replacing load()/flush().
- [x] Officer path: `/api/whatsapp/admin/{handovers,session/:phone,reply,close,notify}` (Bearer `ADMIN_TOKEN`) and the
      optional `HANDOVER_WEBHOOK_URL` push. Proactive complaint update respects STOP, the 24-hour window and templates.
- [x] Complaint tickets numbered server-side (persisted counter) and looked up later from any device.
- [ ] Still open: analytics store, officer console UI (the API exists), FAQ admin tooling, complaint integration
      with the client's system (tickets are a holding record today).

#### 8.4 Content and data
- [ ] Confirm the target body is SEC Bihar and the 68 FAQs + Act PDFs are current. **(client)**
- [ ] Election Rules (Panchayat 2006, Municipal 2007) and circulars, to close the Act-answer gaps (Phase 5: 63% pass). **(client)**
- [ ] Human review of the OCR Hindi Act text and the machine-translated 2021 amendment. **(client / Hindi legal reviewer)**
- [ ] Approved HI/EN copy for consent, welcome, fallback, STOP confirmation, handover; template wording. **(client)**
- [ ] Decision on Hinglish replies; handling of Bhojpuri / Maithili (reply in simple Hindi).
- [ ] Larger test set (Hinglish and Act questions) and a third fine-tune round if the pilot shows gaps.
- [ ] Ship the Phase 5 fix: exact section text sent with each Act answer.

#### 8.5 Compliance and legal
- [ ] Opt-in design and per-number consent record (Meta policy, DPDP).
- [ ] Privacy notice and retention schedule for transcripts and phone numbers. **(client)**
- [ ] Written approval for the Commission's name and emblem on the number (current approval covers the demo only). **(client)**
- [ ] Access control and audit trail for anyone reading transcripts.
- [ ] Neutrality / model code of conduct review of bot behaviour during election periods. **(client)**

#### 8.6 People and process
- [ ] Named client owner for approvals and the Meta account. **(client)**
- [ ] Officers on the handover queue with defined working hours. **(client)**
- [ ] Closed pilot: 20–50 officials, two weeks, every Act answer logged and reviewed; fix top failure patterns.
- [ ] Go-live checklist, incident contact, peak-load plan for nomination and polling dates.
- [ ] Cost sign-off: Meta conversation charges, OpenAI usage, hosting, BSP fees.

#### Order of work
1. Decide channel; start 8.1 verification and number procurement; request 8.4 client documents.
2. Build 8.2 datastore + 8.3 webhook, sender and session state machine; test on the sandbox number.
3. Port flows and menu; wire handover and complaints; submit templates.
4. Compliance sign-off (8.5), then the closed pilot (8.6).
5. Public go-live only after pilot numbers and sign-off.

## Risks and notes
- **sec.bihar.gov.in HTTPS certificate expired on 22 Oct 2026** (browsers show "Privacy error"); the bot's website
  link is a setting, off until the certificate is renewed.
- **Acts may be outdated**: the 2006/2007 Acts have later amendments; answers show the Act and year, and we request
  the latest consolidated Acts + Election Rules (Panchayat Election Rules 2006, Municipal Election Rules 2007) + circulars.
- OCR of legal text: spot-checked in the quality report; the English Acts remain the primary source for answers.
- Officials Q&As are visible to anyone using the demo.

## Estimated OpenAI cost
- Document processing and search: $0 (open-source, local)
- Per text answer: ≈ ₹0.10–0.25
