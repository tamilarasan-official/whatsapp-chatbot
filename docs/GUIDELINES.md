# Production Guidelines: SEC Bihar WhatsApp Help Desk

Operating rules for the live system. Read this before touching the `production` branch, the Dokploy
service, the Meta app or the client's data. Setup steps live in `docs/DEPLOY.md` and `docs/WHATSAPP.md`;
this file is about how we run it safely day to day.

## 1. Branches and releases

| Branch | Purpose | Who may push |
|---|---|---|
| `main` | development, every change lands here first | developers |
| `production` | exactly what Dokploy deploys | release owner only, fast-forward from `main` |

- Never commit directly on `production`. Merge `main` into it with `--ff-only` and push.
- Every release must pass locally before the merge:
  ```
  npm run test:wa        # WhatsApp flows, limits, webhook, admin API (offline, 40 checks)
  node scripts/verify-node-search.js   # search model ranks as evaluated (needs the model file)
  BASE_URL=https://apivalardemo.welocalhost.com npm run test:ai   # after deploy, against the live API
  ```
- Changes to prompts, score floors, the FAQ matcher or the search model also need `npm run test:kb`
  (accuracy test, ~120 questions, costs OpenAI credits). Do not release if pass rate, invented facts or
  language match got worse than `docs/accuracy-report.html` from the previous release.
- Commit messages say what changed for the user, not which file was edited. Tag releases that go to the
  client: `git tag -a v1.x -m "..."`.
- Deploy only during Commission working hours and never on a polling or counting day unless fixing an outage.

## 2. Secrets and environment

- Secrets exist only in Dokploy > Environment: `OPENAI_API_KEY`, `HF_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `ADMIN_TOKEN`. Never in git, Docker images, chat
  messages, screenshots or tickets.
- `WHATSAPP_ACCESS_TOKEN` must be a **System User permanent token**, never the 24-hour test token.
- Rotate `ADMIN_TOKEN` and the WhatsApp token when a person with access leaves, and the OpenAI key if it was
  ever pasted anywhere. After rotating, click **Redeploy** (env changes need a restart).
- OpenAI: keep a monthly usage limit on the key. Expected cost is about ₹0.10–0.25 per answered question.
- The Hugging Face token is read-only and only used at build time; the search model is private to us.

## 3. Deploying and rolling back

1. Merge and push `production`, then Dokploy > Deploy (or Auto Deploy on).
2. Watch the backend log until `WhatsApp: live, webhook /webhook/whatsapp ...` and `Search model ... loaded`.
3. Check `https://apivalardemo.welocalhost.com/api/health`: `ok: true`, `aiConfigured: true`,
   `whatsapp.configured: true`, `whatsapp.dryRun: false`.
4. Send one message from a test phone and confirm a reply.
5. Rollback = Dokploy > Deployments > redeploy the previous entry. Session profiles live in the `wa-state`
   volume, so a rollback never loses STOP opt-outs or language choices.
6. Never delete the `wa-state` volume. It holds the per-number STOP list, which the Commission is legally
   required to honour.

## 4. Daily operations

Check once each working morning, and after any Meta or OpenAI incident:

- `/api/health` returns `ok: true`.
- Backend logs: no `Graph API 401/403` (token problem), no repeated `LLM request failed`, no
  `[session] could not write` (volume problem).
- Meta > WhatsApp Manager > Insights: delivery rate and quality rating. A quality drop or a "flagged"
  status means users are blocking the number; stop all proactive messages and review template content.
- Officer queue: `GET /api/whatsapp/admin/handovers`. Nobody should wait longer than one working day.
- OpenAI usage dashboard: a sudden spike means abuse; lower `WHATSAPP_RATE_LIMIT_PER_MIN` and check logs.

## 5. Officer handover

- A chat reaches the queue when the user asks for a person, is angry, or the AI sets `action: handover`.
  The bot then stays silent for that number for `HANDOVER_TTL_MIN` (60) minutes or until the officer closes it.
- Officers reply with `POST /api/whatsapp/admin/reply` and finish with `POST /api/whatsapp/admin/close`.
  Replies go out under the Commission's number as "Help-desk officer", so write as the Commission.
- Officers never ask for Aadhaar, EPIC, OTP or passwords in the chat. If a user sends them, delete nothing
  (Meta keeps the message anyway) but do not copy them into any other system.
- Officers answer in the user's language. Hindi for Hindi and Hinglish users unless they wrote in English.
- Political questions: the same neutrality rule as the bot. Officers do not comment on parties,
  candidates or results. Point to the official process only.
- If `HANDOVER_WEBHOOK_URL` is set, every handover is also pushed there. Keep that destination inside the
  Commission (no personal WhatsApp groups, no public Slack channels).

## 6. Content updates (FAQs, Acts, menu)

- FAQs: edit `data/kb/faqs.json`, copy to `data/faqs.json`, then rebuild the index
  (`scripts/kb/build_index.py`, see `scripts/kb/README.md`) and re-run `verify_index.py`. A changed FAQ
  without a rebuilt index is matched by the old embedding and may surface the wrong answer.
- New or amended Acts and the Election Rules go through the full Phase 1 pipeline (extract, sections,
  corrections, index) and a fresh `npm run test:kb` before release.
- Menu wording: `data/menu.json`. Row titles are clipped at 24 characters on WhatsApp; keep them short.
- Bot strings (consent, STOP text, handover text): `server/session/strings.js`. Any change to the consent
  or STOP wording must be approved by the Commission first.
- Every content change is a release (section 1). Do not hot-edit files on the server.

## 7. Data protection

- Personal data we hold: phone numbers, the user's chosen language, consent time, STOP state, complaints
  typed into the bot, reminders. Stored in `wa-state/whatsapp-profiles.json` on the server only.
- Transcripts are in memory for `SESSION_TTL_MIN` (24 h) and are never written to disk by us. Meta keeps its
  own copies under its terms.
- Citizen messages are sent to OpenAI to generate answers. This must be stated in the Commission's privacy
  notice. If the Commission objects, switch `OPENAI_MODEL` to an India-hosted endpoint and re-run `test:kb`.
- Access to the server, Dokploy and `ADMIN_TOKEN` is limited to named people. Keep a list.
- Do not export, screenshot or share phone numbers or complaint texts outside the Commission.
  For debugging, use the last four digits as the logs do.
- Deleting a user's data on request: remove their entry from `whatsapp-profiles.json` (stop the backend,
  edit, start) and ask Meta support for the conversation if required.

## 8. The bot's own rules (do not weaken)

- Answers come only from the knowledge base. The prompt, grounding checks and citation validation in
  `server/answer.js` and `server/llm.js` are safety features; do not loosen score floors or remove the
  retry to make a demo look smoother.
- Political neutrality is enforced twice: the deterministic guard in `server/guard.js` and the prompt.
  Add new phrasings to the guard when one slips through; never remove patterns because they feel strict.
- The PII guard, STOP/START handling and the 500-character message cap stay on.
- Officials-only FAQs are answered only when the user opened the officials menu or the match is very strong.
- The bot never states that an election, date or result has been announced.

## 9. Incidents

| Situation | Do this |
|---|---|
| No replies at all | `/api/health` down? Dokploy > restart backend. Up but `dryRun: true`? Env var missing, Redeploy. |
| Replies are "cannot answer right now" for everything | OpenAI key, quota or outage. Check backend log for `LLM request failed`. Users still get official FAQ text for strong matches; officers should watch the queue. |
| Webhook shows errors in Meta | Backend returned non-200 or timed out. Check logs; Meta retries for hours, duplicates are ignored by design. |
| Wrong or harmful answer reported | Capture the exact message and reply, add it to `data/kb/eval/answer_tests.json`, fix (guard, prompt, FAQ or index), re-run `test:kb`, release. Tell the Commission what changed. |
| Number quality rating drops | Pause all `notify` calls, review template wording, make sure STOP is honoured (it is enforced server-side). |
| Suspected token leak | Rotate in Meta / OpenAI immediately, update Dokploy env, Redeploy, then investigate. |

Incident owner: the person on the rota for that week. Write a short note (what, when, impact, fix) in the
project tracker within one working day. The Commission's contact is informed for anything user-visible
that lasted more than 30 minutes or produced a wrong answer on a legal question.

## 10. Before each election period

- Confirm the FAQs, Acts and helpline numbers with the Commission; release updates two weeks before nominations.
- Load test is not needed for expected volumes (hundreds of chats a day) but check the OpenAI rate limits
  on the account and raise the monthly cap.
- Agree officer rota and working hours for the handover queue; set `HANDOVER_TTL_MIN` accordingly.
- Freeze releases from the day before polling to the day after counting.
