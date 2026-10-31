// Offline test of the WhatsApp channel: no Meta account, no OpenAI key, no search model needed.
//   npm run test:wa
// Part 1 drives the conversation engine through every scripted flow with a fake answer engine and checks
// each outbound message against the Cloud API limits. Part 2 starts the real webhook router on a local
// port and checks Meta's handshake, signatures, de-duplication, ordering, rate limiting and the admin API.
process.env.WHATSAPP_ACCESS_TOKEN = '';            // dry run: nothing is sent
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-123';
process.env.ADMIN_TOKEN = 'admin-123';
process.env.WHATSAPP_RATE_LIMIT_PER_MIN = '5';
process.env.WHATSAPP_TEMPLATE_COMPLAINT_UPDATE = '';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { createEngine } = require('../server/session/engine');
const { SessionStore } = require('../server/session/store');
const { createSender, toPayloads } = require('../server/whatsapp/send');
const { violations, LIMITS } = require('../server/whatsapp/limits');
const { createWebhook, createAdmin } = require('../server/whatsapp/webhook');
const { loadData } = require('../server/whatsapp');

const data = loadData();
const ASSETS = 'https://example.test/assets';
let clock = Date.parse('2026-11-01T10:00:00+05:30');
const now = () => clock;
const advance = (ms) => { clock += ms; };
const HOUR = 3600 * 1000;

// ---------- fake answer engine (stands in for server/answer.js) ----------
const fakeRespond = async ({ message, language }) => {
  if (/throw/.test(message)) throw new Error('simulated LLM outage');
  if (/complain/i.test(message)) return { reply: 'Sorry to hear that. Please describe the problem in one message.', language: 'en', intent: 'complaint', confidence: 0.9, citations: [], escalate: false, action: 'grievance', suggested_replies: [], route: 'chat' };
  if (/\b(talk|speak|connect)\b.*\b(human|officer|person)\b/i.test(message)) return { reply: 'Connecting you to an officer.', language: 'en', intent: 'handover', confidence: 0.9, citations: [], escalate: true, action: 'handover', suggested_replies: [], route: 'chat' };
  if (/weather/i.test(message)) return { reply: 'I can only help with Panchayat and Municipal election questions.', language: 'en', intent: 'out_of_scope', confidence: 0.9, citations: [], escalate: false, action: 'none', suggested_replies: ['Voter list?'], route: 'chat' };
  // Like the real engine, the reply language follows the message's script, then the user's preference.
  const lang = /[ऀ-ॿ]/.test(message) ? 'hi' : /[a-z]{3,}/i.test(message) ? 'en' : language;
  return {
    reply: lang === 'hi' ? 'ग्राम पंचायत का कार्यकाल पाँच वर्ष का होता है।' : 'A Gram Panchayat has a term of five years.',
    language: lang, intent: 'act', confidence: 0.86, escalate: false, action: 'none',
    citations: [{ type: 'act', act: 'Bihar Panchayat Raj Act, 2006', section: '14', title: 'Duration of Gram Panchayat', doc: 'panchayat_act_en', page: 12, reliability: 'high' }],
    suggested_replies: ['Mukhiya ki umar?', 'Reservation rules?', 'Counting process?'], route: 'act', latency_ms: 5,
  };
};

// ---------- tiny test runner ----------
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); } catch (err) { failed += 1; console.log(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`); }
}

// Every outbound message must be valid as produced AND every Cloud API payload made from it must be within limits.
function checkLimits(messages, to = '919999999999') {
  for (const m of messages) {
    const v = violations(m).filter((x) => !/^body > /.test(x)); // long bodies are split by the sender
    assert.deepStrictEqual(v, [], `message violates limits: ${v.join('; ')}`);
    for (const p of toPayloads(to, m)) {
      if (p.type === 'text') assert.ok(p.text.body.length <= LIMITS.TEXT_BODY && p.text.body.length > 0, 'text payload size');
      if (p.type === 'interactive') {
        assert.ok(p.interactive.body.text.length <= LIMITS.INTERACTIVE_BODY, 'interactive body size');
        for (const b of p.interactive.action.buttons || []) assert.ok(b.reply.title.length <= LIMITS.BUTTON_TITLE, `button title: ${b.reply.title}`);
        const rows = (p.interactive.action.sections || []).flatMap((s) => s.rows);
        assert.ok(rows.length <= LIMITS.LIST_ROWS, 'rows');
        for (const r of rows) { assert.ok(r.title.length <= LIMITS.ROW_TITLE, `row title: ${r.title}`); assert.ok(!r.description || r.description.length <= LIMITS.ROW_DESCRIPTION, 'row desc'); }
      }
    }
  }
}

function harness({ respond = fakeRespond, dir = null } = {}) {
  const store = new SessionStore({ dir, ttlMs: 24 * HOUR, persist: Boolean(dir), now, defaultLang: 'hi' });
  const handovers = [];
  const engine = createEngine({ data, store, respond, assetsBase: ASSETS, handoverTtlMs: HOUR, now, onHandover: (p) => handovers.push(p), log: () => {} });
  let seq = 0;
  const msg = (from, fields) => ({ id: `wamid.${++seq}`, from, name: 'Test User', timestamp: now(), type: 'text', text: '', replyId: null, replyTitle: null, ...fields });
  const say = async (from, text) => { const r = await engine.handleInbound(msg(from, { text })); checkLimits(r.messages, from); return r; };
  const tap = async (from, id, title = id) => { const r = await engine.handleInbound(msg(from, { type: 'interactive', replyId: id, replyTitle: title, text: title })); checkLimits(r.messages, from); return r; };
  const media = async (from) => { const r = await engine.handleInbound(msg(from, { type: 'image' })); checkLimits(r.messages, from); return r; };
  return { store, engine, say, tap, media, handovers };
}

const last = (r) => r.messages[r.messages.length - 1];
const titles = (m) => (m.buttons || m.sections.flatMap((s) => s.rows)).map((b) => b.title);
const ids = (m) => (m.buttons || m.sections.flatMap((s) => s.rows)).map((b) => b.id);

async function part1() {
  console.log('\nPart 1: conversation engine');
  const U = '919812345678';
  const h = harness();

  await test('first contact: consent + language buttons, message consumed', async () => {
    const r = await h.say(U, 'hi');
    assert.strictEqual(r.messages.length, 1);
    assert.strictEqual(r.messages[0].type, 'buttons');
    assert.deepStrictEqual(ids(r.messages[0]), ['lang:hi', 'lang:en']);
    assert.strictEqual(r.session.step, 'lang');
  });

  await test('language tap -> main menu list with every menu item', async () => {
    const r = await h.tap(U, 'lang:hi', 'हिन्दी');
    assert.strictEqual(last(r).type, 'list');
    assert.strictEqual(ids(last(r)).length, data.menu.items.length);
    assert.strictEqual(r.session.lang, 'hi');
    assert.ok(r.session.consentAt);
  });

  await test('numeric reply picks a list row (1 = first topic), FAQ list is numbered', async () => {
    const r = await h.say(U, '1');
    assert.strictEqual(last(r).type, 'list');
    const rows = last(r).sections[0].rows;
    assert.ok(rows.length <= 10 && rows[0].title.startsWith('1. '));
    assert.ok(/\n1\. /.test(last(r).text), 'body lists the full questions');
  });

  await test('numeric reply picks an FAQ -> official answer with source and menu/officer buttons', async () => {
    const r = await h.say(U, '2');
    const m = last(r);
    assert.strictEqual(m.type, 'buttons');
    assert.deepStrictEqual(ids(m), ['menu', 'officer']);
    assert.ok(m.text.includes('📌'));
    assert.ok(/[ऀ-ॿ]/.test(m.text), 'Hindi answer for a Hindi user');
  });

  await test('"More questions" row pages the list', async () => {
    const r = await h.tap(U, 'menu:evoting', 'eVoting');
    const more = ids(last(r)).find((id) => id.startsWith('topic:evoting:1'));
    assert.ok(more, 'eVoting has more than 9 FAQs');
    const r2 = await h.tap(U, more, 'और प्रश्न…');
    assert.ok(last(r2).sections[0].rows[0].title.startsWith('10. '));
  });

  await test('complaint number in free text -> status card with remind + officer', async () => {
    const r = await h.say(U, 'status CMP-2026-00412 please');
    const m = last(r);
    assert.strictEqual(m.type, 'buttons');
    assert.ok(m.text.includes('CMP-2026-00412'));
    assert.deepStrictEqual(ids(m), ['remind:CMP-2026-00412', 'officer']);
  });

  await test('remind tap stores a reminder', async () => {
    const r = await h.tap(U, 'remind:CMP-2026-00412', 'मुझे सूचित करें');
    assert.strictEqual(last(r).type, 'text');
    assert.ok(r.session.reminders.includes('CMP-2026-00412'));
  });

  await test('register a complaint: menu -> new -> text -> ticket + feedback; ticket is then looked up', async () => {
    await h.tap(U, 'menu:complaint', 'शिकायत');
    const r1 = await h.tap(U, 'cmp:new', 'शिकायत दर्ज करें');
    assert.strictEqual(r1.session.step, 'complaint');
    const r2 = await h.say(U, 'मतदाता सूची में मेरा नाम गलत लिखा है');
    const ticket = r2.session.lastTicket;
    assert.match(ticket, /^CMP-2026-\d{5}$/);
    assert.strictEqual(r2.messages[0].type, 'text');
    assert.deepStrictEqual(ids(last(r2)), ['fb:yes', 'fb:no']);
    const r3 = await h.say(U, ticket);
    assert.ok(last(r3).text.includes(ticket) && last(r3).text.includes('दर्ज'));
  });

  await test('invalid complaint number while asked for one', async () => {
    await h.tap(U, 'cmp:status', 'स्थिति देखें');
    const r = await h.say(U, 'CMP 412');
    assert.deepStrictEqual(ids(last(r)), ['officer', 'menu']);
  });

  await test('PII guard blocks Aadhaar-like numbers', async () => {
    const r = await h.say(U, 'mera aadhaar 1234 5678 9012 hai');
    assert.ok(last(r).text.startsWith('⚠️'));
  });

  await test('free text -> AI reply with citation line, PDF link and suggestion buttons', async () => {
    const r = await h.say(U, 'ग्राम पंचायत का कार्यकाल कितना है?');
    const m = last(r);
    assert.strictEqual(m.type, 'buttons');
    assert.ok(m.text.includes('धारा 14') && m.text.includes(`${ASSETS}/docs/`) && m.text.includes('#page=12'));
    assert.strictEqual(m.buttons.length, 3);
    assert.ok(!ids(m).includes('officer'), 'confident reply: no officer button');
    assert.ok(titles(m).every((x) => x.length <= 20));
  });

  await test('English message switches reply language but keeps Hindi UI until script changes', async () => {
    const r = await h.say(U, 'What is the term of a Gram Panchayat?');
    assert.ok(last(r).text.includes('five years'));
    assert.strictEqual(r.session.lang, 'hi');
  });

  await test('out-of-scope reply adds the officer button', async () => {
    const r = await h.say(U, 'what is the weather today');
    assert.ok(ids(last(r)).includes('officer'));
  });

  await test('AI action grievance puts the session in complaint step', async () => {
    const r = await h.say(U, 'I want to complain about the booth');
    assert.strictEqual(r.session.step, 'complaint');
    assert.strictEqual(last(r).type, 'text');
    await h.say(U, 'booth was closed');
  });

  await test('officer request: handover, officer webhook called, bot stays quiet, "menu" returns', async () => {
    const r = await h.say(U, 'officer');
    assert.ok(r.session.handover);
    assert.strictEqual(h.handovers.length, 1);
    const r2 = await h.say(U, 'hello? anyone there');
    assert.strictEqual(r2.messages.length, 0, 'no notice within 10 minutes of the handover');
    advance(11 * 60 * 1000);
    const r3 = await h.say(U, 'hello??');
    assert.strictEqual(r3.messages.length, 1);
    const r4 = await h.say(U, 'menu');
    assert.ok(!r4.session.handover && last(r4).type === 'list');
  });

  await test('election terms with officer/agent do not trigger a handover; explicit requests do', async () => {
    for (const q of ['who is the returning officer?', 'what does a polling agent do', 'presiding officer duties?']) {
      const r = await h.say(U, q);
      assert.ok(!r.session.handover, `"${q}" should not hand over`);
      assert.ok(last(r).text.includes('five years'), 'answered by the answer engine');
    }
    for (const q of ['talk to an officer', 'connect me to a human', 'अधिकारी से बात करनी है', 'customer care']) {
      const r = await h.say(U, q);
      assert.ok(r.session.handover, `"${q}" should hand over`);
      await h.say(U, 'menu');
    }
  });

  await test('officer reply and close through the engine API', async () => {
    await h.say(U, 'adhikari');
    const reply = h.engine.agentReply(U, 'Namaste, this is the help desk.');
    assert.ok(reply[0].text.includes('Namaste'));
    checkLimits(reply, U);
    const close = h.engine.agentClose(U);
    assert.strictEqual(close.length, 2);
    assert.ok(!h.store.peek(U).handover);
  });

  await test('handover expires after HANDOVER_TTL and the bot answers again', async () => {
    await h.say(U, 'officer');
    advance(2 * HOUR);
    const r = await h.say(U, 'ग्राम पंचायत का कार्यकाल?');
    assert.ok(!r.session.handover && last(r).type === 'buttons');
  });

  await test('STOP / START and proactive notifications (window, template, opt-out)', async () => {
    const r = await h.say(U, 'STOP');
    assert.ok(r.session.optedOut);
    assert.deepStrictEqual(h.engine.notify(U, { ref: 'CMP-2026-00412' }), { ok: false, reason: 'opted_out' });
    await h.say(U, 'START');
    const inWindow = h.engine.notify(U, { ref: 'CMP-2026-00412', statusKey: 'approved' });
    assert.ok(inWindow.ok && inWindow.messages[0].type === 'buttons' && !inWindow.viaTemplate);
    checkLimits(inWindow.messages, U);
    advance(25 * HOUR);
    assert.strictEqual(h.engine.notify(U, { ref: 'CMP-2026-00412' }).reason, 'template_required');
    const viaTemplate = h.engine.notify(U, { ref: 'CMP-2026-00412', templateName: 'complaint_update' });
    assert.ok(viaTemplate.ok && viaTemplate.messages[0].type === 'template' && viaTemplate.viaTemplate);
  });

  await test('after 24 h of silence a greeting shows the welcome-back menu (no consent again)', async () => {
    const r = await h.say(U, 'namaste');
    assert.strictEqual(last(r).type, 'list');
    assert.ok(last(r).text.includes('फिर से'));
  });

  await test('images / audio get a "text only" reply', async () => {
    const r = await h.media(U);
    assert.strictEqual(r.messages.length, 1);
  });

  await test('documents: list of Acts, then a document message with a public PDF link + feedback', async () => {
    const r = await h.tap(U, 'menu:acts', 'Acts');
    assert.strictEqual(last(r).type, 'list');
    assert.strictEqual(ids(last(r)).length, data.documents.length);
    const r2 = await h.say(U, '1');
    assert.strictEqual(r2.messages[0].type, 'document');
    assert.ok(r2.messages[0].link.startsWith(`${ASSETS}/docs/`) && r2.messages[0].link.endsWith('.pdf'));
    assert.deepStrictEqual(ids(last(r2)), ['fb:yes', 'fb:no']);
  });

  await test('officials menu sets audience=officials for the answer engine', async () => {
    const item = data.menu.items.find((i) => i.audience === 'officials');
    assert.ok(item, 'menu has an officials section');
    const r = await h.tap(U, `menu:${item.key}`, item.title);
    assert.strictEqual(r.session.audience, 'officials');
    const r2 = await h.tap(U, 'menu', 'Main menu');
    assert.strictEqual(r2.session.audience, null);
  });

  await test('feedback buttons', async () => {
    assert.strictEqual(last(await h.tap(U, 'fb:yes', 'Yes')).type, 'text');
    assert.deepStrictEqual(ids(last(await h.tap(U, 'fb:no', 'No'))), ['officer', 'menu']);
  });

  await test('new user who types a question first gets it answered right after choosing a language', async () => {
    const V = '919700000001';
    const r = await h.say(V, 'Mukhiya kaun ban sakta hai?');
    assert.strictEqual(r.messages[0].type, 'buttons');
    const r2 = await h.tap(V, 'lang:en', 'English');
    assert.strictEqual(r2.session.lang, 'en');
    assert.ok(last(r2).text.includes('five years'), 'the pending question was answered, not the menu shown');
  });

  await test('typed language word and Devanagari first message set the language', async () => {
    const W = '919700000002';
    await h.say(W, 'hello');
    const r = await h.say(W, 'English');
    assert.strictEqual(r.session.lang, 'en');
    const X = '919700000003';
    await h.say(X, 'नमस्ते');
    const r2 = await h.say(X, 'ग्राम पंचायत का कार्यकाल?');
    assert.strictEqual(r2.session.lang, 'hi');
    assert.ok(/[ऀ-ॿ]/.test(last(r2).text));
  });

  await test('"ok" / emoji instead of a language choice continues in Hindi with the menu', async () => {
    const K = '919700000011';
    await h.say(K, 'hi');
    const r = await h.say(K, 'ok');
    assert.strictEqual(r.session.lang, 'hi');
    assert.strictEqual(last(r).type, 'list');
    const K2 = '919700000012';
    await h.say(K2, 'hello');
    const r2 = await h.say(K2, '👍');
    assert.strictEqual(last(r2).type, 'list');
  });

  await test('over-long message gets a specific reply, not the generic fallback', async () => {
    const r = await h.say(U, 'x'.repeat(600));
    assert.strictEqual(last(r).type, 'text');
    assert.ok(/500/.test(last(r).text));
  });

  await test('model reply clean-up: Markdown bold and leaked "Citations:" are removed', async () => {
    const { cleanReply } = require('../server/llm');
    assert.strictEqual(cleanReply('Term is **5 years**. Citations: ["F1"]'), 'Term is *5 years*.');
    assert.strictEqual(cleanReply('Section 125 says X. This is general information. Citations: [S1]'), 'Section 125 says X. This is general information.');
    assert.strictEqual(cleanReply('## Heading\nBody (citations: [F1, S2]).'), 'Heading\nBody.');
  });

  await test('neutrality guard: vote advice / predictions in hi, en, Hinglish; legit party-symbol questions pass', async () => {
    const { isPolitical } = require('../server/guard');
    const blocked = ['कौन सी पार्टी को वोट दूँ?', 'किसे वोट दें?', 'इस बार कौन जीतेगा?', 'kis party ko vote du', 'kaun jeetega patna me',
      'Which party should I vote for?', 'Who will win in Patna?', 'who should we vote for in the panchayat election', 'is BJP better than RJD here'];
    const allowed = ['Can candidates contest on a party symbol?', 'क्या प्रत्याशी पार्टी के चुनाव चिह्न पर लड़ सकते हैं?', 'How are symbols allotted to candidates?',
      'How do I vote on the eVoting app?', 'मतदान कैसे करें?', 'What is the counting process?', 'kaun mukhiya ban sakta hai', 'who can become a ward councillor'];
    for (const q of blocked) assert.ok(isPolitical(q), `should block: ${q}`);
    for (const q of allowed) assert.ok(!isPolitical(q), `should allow: ${q}`);
  });

  await test('answer engine failure -> fallback with officer button, no crash', async () => {
    const r = await h.say(U, 'please throw');
    assert.deepStrictEqual(ids(last(r)), ['officer']);
  });

  await test('STOP and language survive a restart (profile persisted), transcript does not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
    const a = harness({ dir });
    const Y = '919700000009';
    await a.say(Y, 'hi'); await a.tap(Y, 'lang:en', 'English'); await a.say(Y, 'STOP');
    a.store.flush();
    const b = harness({ dir });
    const s = b.store.get(Y);
    assert.strictEqual(s.optedOut, true);
    assert.strictEqual(s.lang, 'en');
    assert.strictEqual(s.history.length, 0);
    const raw = fs.readFileSync(path.join(dir, 'whatsapp-profiles.json'), 'utf8');
    assert.ok(!raw.includes('"history"'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// ---------- Part 2: the HTTP layer ----------
const sign = (body) => `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
const webhookBody = (from, text, id) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '42' },
    contacts: [{ wa_id: from, profile: { name: 'Curl User' } }],
    messages: [{ id, from, timestamp: String(Math.floor(now() / 1000)), type: 'text', text: { body: text } }] } }] }],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); } return fn(); }

async function part2() {
  console.log('\nPart 2: webhook and admin over HTTP');
  const sent = [];
  const transport = async (payload) => { sent.push(payload); return { messages: [{ id: `t.${sent.length}` }] }; };
  const store = new SessionStore({ persist: false, now, defaultLang: 'hi' });
  const engine = createEngine({ data, store, respond: fakeRespond, assetsBase: ASSETS, now, log: () => {} });
  const sender = createSender({ transport });
  const app = express();
  app.use('/webhook/whatsapp', createWebhook({ engine, sender, store, now }));
  app.use('/api/whatsapp/admin', createAdmin({ engine, sender, store }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body), ...headers }, body });
  const outboundTo = (phone) => sent.filter((p) => p.to === phone && p.type !== undefined && !p.status);
  const U = '919811111111';

  await test('GET handshake: right token echoes the challenge, wrong token is 403', async () => {
    const ok = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-123&hub.challenge=12345`);
    assert.strictEqual(ok.status, 200); assert.strictEqual(await ok.text(), '12345');
    const bad = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    assert.strictEqual(bad.status, 403);
  });

  await test('POST without a valid signature is rejected (401), nothing processed', async () => {
    const body = webhookBody(U, 'hi', 'wamid.bad');
    assert.strictEqual((await post(body, { 'X-Hub-Signature-256': 'sha256=deadbeef' })).status, 401);
    assert.strictEqual((await fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    await sleep(50);
    assert.strictEqual(outboundTo(U).length, 0);
  });

  await test('signed POST: 200 at once, message marked read, consent sent', async () => {
    const res = await post(webhookBody(U, 'hi', 'wamid.1'));
    assert.strictEqual(res.status, 200);
    assert.ok(await waitFor(() => outboundTo(U).length >= 1));
    assert.ok(sent.some((p) => p.status === 'read' && p.message_id === 'wamid.1' && p.typing_indicator));
    assert.strictEqual(outboundTo(U)[0].interactive.type, 'button');
  });

  await test('Meta retry with the same message id is answered only once', async () => {
    const before = outboundTo(U).length;
    await post(webhookBody(U, 'hi', 'wamid.1'));
    await sleep(100);
    assert.strictEqual(outboundTo(U).length, before);
  });

  await test('messages from one number are processed in order', async () => {
    const before = outboundTo(U).length;
    await Promise.all([post(webhookBody(U, 'English', 'wamid.2')), post(webhookBody(U, '6', 'wamid.3'))]); // 6 = Complaints in the menu
    assert.ok(await waitFor(() => outboundTo(U).length >= before + 2));
    const [menu, complaints] = outboundTo(U).slice(before);
    assert.strictEqual(menu.interactive.type, 'list');
    assert.strictEqual(complaints.interactive.type, 'button');
  });

  await test('per-phone rate limit: one "slow down", then silence until the next minute', async () => {
    const Z = '919822222222';
    for (let i = 0; i < 9; i++) await post(webhookBody(Z, `msg ${i}`, `wamid.z${i}`));
    await sleep(200);
    const out = outboundTo(Z);
    assert.strictEqual(out.length, 6, `5 answered + 1 warning, got ${out.length}`);
    assert.ok(out[5].text.body.includes('धीरे'));
  });

  await test('admin API: 403 without token; handovers, reply, close, notify with token', async () => {
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer admin-123' };
    assert.strictEqual((await fetch(`${base}/api/whatsapp/admin/handovers`)).status, 403);
    await post(webhookBody(U, 'officer', 'wamid.4'));
    await waitFor(() => store.peek(U)?.handover);
    const list = await (await fetch(`${base}/api/whatsapp/admin/handovers`, { headers: H })).json();
    assert.strictEqual(list.handovers[0].phone, U);
    const reply = await fetch(`${base}/api/whatsapp/admin/reply`, { method: 'POST', headers: H, body: JSON.stringify({ to: U, text: 'Officer here.' }) });
    assert.strictEqual(reply.status, 200);
    assert.ok(outboundTo(U).at(-1).text.body.includes('Officer here.'));
    const close = await fetch(`${base}/api/whatsapp/admin/close`, { method: 'POST', headers: H, body: JSON.stringify({ to: U }) });
    assert.strictEqual(close.status, 200);
    assert.ok(!store.peek(U).handover);
    const notify = await fetch(`${base}/api/whatsapp/admin/notify`, { method: 'POST', headers: H, body: JSON.stringify({ to: U, ref: 'CMP-2026-00412', status: 'approved' }) });
    assert.strictEqual(notify.status, 200);
    const session = await (await fetch(`${base}/api/whatsapp/admin/session/${U}`, { headers: H })).json();
    assert.strictEqual(session.history, undefined);
    assert.strictEqual(session.statusOverrides['CMP-2026-00412'], 'approved');
  });

  await test('malformed JSON and non-WhatsApp objects do not crash the webhook', async () => {
    const r = await post('{not json');
    assert.ok([400, 401].includes(r.status));
    const other = JSON.stringify({ object: 'page', entry: [] });
    assert.strictEqual((await post(other)).status, 200);
  });

  server.close();
}

(async () => {
  await part1();
  await part2();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
