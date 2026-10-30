# Plan: State Election Commission, Bihar — WhatsApp Bot

Client: **State Election Commission, Bihar** (राज्य निर्वाचन आयोग, बिहार), which runs Panchayat and
Municipal (local body) elections. Replaces the ECI demo content.

Decisions (confirmed):
- Name: yes. **No State Emblem**: neutral ballot-box avatar + name text
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

### Phase 4: Rebrand the demo
- Name "State Election Commission, Bihar" / "राज्य निर्वाचन आयोग, बिहार", neutral ballot-box avatar (no emblem), Hindi default.
- Language buttons: हिन्दी, English (Tamil removed).
- Menu: Panchayat elections · Municipal elections · eVoting SECBHR app · Voter list / e-Roll · Nomination & candidates ·
  Complaints · For election officials · Talk to an officer.
- Documents: the actual public Acts (EN/HI) as downloadable PDFs.
- Mock records: complaint status (e.g. CMP-2026-xxxxx), sample notification; home screen, prompt chips, client pack updated.
- Static and AI modes kept.

### Phase 5: Accuracy testing
- ~120 questions: 68 FAQ paraphrases (HI/EN/Hinglish) + ~50 Act questions with expected section.
- `npm run test:kb` reports: FAQ hit rate, correct section cited, invented facts (target 0), language match.

### Phase 6: Deploy
- Same Dokploy compose (frontend + backend, same domains). Backend memory limit 256 MB -> 512 MB for the index.
- Optional: password-protect the demo link (government branding on a public URL).

### Phase 7: Client pack
- Demo guide PDF and WhatsApp message regenerated for SEC Bihar.

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
