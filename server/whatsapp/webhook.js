// Express routers for the WhatsApp Cloud API.
//   createWebhook({ engine, sender })  -> router for GET/POST <WEBHOOK_PATH>
//     GET  : Meta's verification handshake (hub.verify_token)
//     POST : signature check (X-Hub-Signature-256), 200 at once, then per-phone ordered processing with
//            de-duplication of Meta's retries and a per-phone rate limit
//   createAdmin({ engine, sender, store }) -> router for officers / integrations, Bearer ADMIN_TOKEN
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { parseWebhook } = require('./parse');
const { t } = require('../session/strings');

const DEDUPE_MAX = 5000;
const DEDUPE_TTL_MS = 15 * 60 * 1000;

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

function validSignature(req) {
  const header = req.get('x-hub-signature-256') || '';
  if (!config.appSecret) return config.allowUnsigned;
  if (!header.startsWith('sha256=') || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', config.appSecret).update(req.rawBody).digest('hex');
  return safeEqual(header.slice(7), expected);
}

// Remembers message ids for a while so a retried delivery is answered once.
function createDedupe({ now = Date.now } = {}) {
  const seen = new Map();
  return (id) => {
    if (!id) return false;
    const ts = now();
    if (seen.size > DEDUPE_MAX) for (const [k, v] of seen) if (ts - v > DEDUPE_TTL_MS) seen.delete(k);
    if (seen.has(id)) return true;
    seen.set(id, ts);
    return false;
  };
}

// Fixed-window counter per phone. Returns 'ok', 'warn' (first message over the limit) or 'drop'.
function createRateLimiter({ perMinute, now = Date.now } = {}) {
  const buckets = new Map();
  return (phone) => {
    const minute = Math.floor(now() / 60000);
    let b = buckets.get(phone);
    if (!b || b.minute !== minute) { b = { minute, count: 0 }; buckets.set(phone, b); }
    b.count += 1;
    if (buckets.size > 10000) for (const [k, v] of buckets) if (v.minute !== minute) buckets.delete(k);
    if (b.count <= perMinute) return 'ok';
    return b.count === perMinute + 1 ? 'warn' : 'drop';
  };
}

// One promise chain per phone keeps a user's messages in order while different users run in parallel.
function createQueues() {
  const chains = new Map();
  return (key, task) => {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.then(task, task).catch((err) => console.error(`[wa] processing failed for …${key.slice(-4)}: ${err.stack || err.message}`));
    chains.set(key, next);
    next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
    return next;
  };
}

function createWebhook({ engine, sender, store, now = Date.now }) {
  const router = express.Router();
  const isDuplicate = createDedupe({ now });
  const rate = createRateLimiter({ perMinute: config.ratePerMinute, now });
  const enqueue = createQueues();

  router.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => res.sendStatus(err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500));

  router.get('/', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && config.verifyToken && token && safeEqual(token, config.verifyToken)) return res.status(200).type('text/plain').send(String(challenge));
    return res.sendStatus(403);
  });

  async function handle(msg) {
    const verdict = rate(msg.from);
    if (verdict === 'drop') return;
    await sender.markRead(msg.id);
    if (verdict === 'warn') {
      const lang = store.peek(msg.from)?.lang || 'hi';
      return sender.deliver(msg.from, [{ type: 'text', text: t(lang, 'slowDown') }]);
    }
    const { messages } = await engine.handleInbound(msg);
    if (messages.length) await sender.deliver(msg.from, messages);
  }

  router.post('/', (req, res) => {
    if (!validSignature(req)) return res.sendStatus(401);
    if (req.body?.object && req.body.object !== 'whatsapp_business_account') return res.sendStatus(200);
    res.sendStatus(200); // Meta retries anything slower than a few seconds: acknowledge first, work after
    const { messages, statuses } = parseWebhook(req.body);
    for (const st of statuses) if (st.status === 'failed') console.warn(`[wa] delivery failed to …${String(st.recipient).slice(-4)}: ${JSON.stringify(st.errors || [])}`);
    for (const msg of messages) {
      if (!msg.from || isDuplicate(msg.id)) continue;
      enqueue(msg.from, () => handle(msg));
    }
  });

  return router;
}

// Officer / integration endpoints. Disabled (403) unless ADMIN_TOKEN is set.
function createAdmin({ engine, sender, store }) {
  const router = express.Router();
  router.use(express.json({ limit: '50kb' }));
  router.use((req, res, next) => {
    const header = req.get('authorization') || '';
    if (!config.adminToken || !header.startsWith('Bearer ') || !safeEqual(header.slice(7), config.adminToken)) return res.status(403).json({ error: 'forbidden' });
    return next();
  });

  const phoneOf = (v) => String(v || '').replace(/\D/g, '');

  router.get('/handovers', (req, res) => res.json({ handovers: store.handovers() }));

  router.get('/session/:phone', (req, res) => {
    const s = store.peek(phoneOf(req.params.phone));
    if (!s) return res.status(404).json({ error: 'not_found' });
    const { history, ...rest } = s; // transcripts are not exposed here
    return res.json({ ...rest, turns: history.length });
  });

  router.post('/reply', async (req, res) => {
    const to = phoneOf(req.body?.to); const text = String(req.body?.text || '').trim();
    if (!to || !text) return res.status(400).json({ error: 'to and text required' });
    const messages = engine.agentReply(to, text);
    if (!messages) return res.status(404).json({ error: 'no conversation with this number' });
    const ids = await sender.deliver(to, messages);
    return res.json({ ok: ids.every(Boolean), ids });
  });

  router.post('/close', async (req, res) => {
    const to = phoneOf(req.body?.to);
    const messages = to && engine.agentClose(to);
    if (!messages) return res.status(404).json({ error: 'no conversation with this number' });
    const ids = await sender.deliver(to, messages);
    return res.json({ ok: ids.every(Boolean), ids });
  });

  router.post('/notify', async (req, res) => {
    const to = phoneOf(req.body?.to); const ref = String(req.body?.ref || '').toUpperCase();
    if (!to || !/^CMP-\d{4}-\d{5}$/.test(ref)) return res.status(400).json({ error: 'to and ref (CMP-YYYY-NNNNN) required' });
    const result = engine.notify(to, { ref, statusKey: req.body?.status || 'approved', templateName: req.body?.template || config.complaintTemplate });
    if (!result.ok) return res.status(result.reason === 'opted_out' ? 403 : 409).json({ error: result.reason });
    const ids = await sender.deliver(to, result.messages);
    return res.json({ ok: ids.every(Boolean), ids, viaTemplate: result.viaTemplate });
  });

  return router;
}

module.exports = { createWebhook, createAdmin, validSignature, createDedupe, createRateLimiter, createQueues };
