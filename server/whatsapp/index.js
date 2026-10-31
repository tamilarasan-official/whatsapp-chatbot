// Assembles the WhatsApp channel: session store, conversation engine, sender and the two routers.
//   const wa = mountWhatsApp(app, { respond });
// Routes: GET/POST /webhook/whatsapp (Meta), /api/whatsapp/admin/* (officers, Bearer ADMIN_TOKEN).
// Without WHATSAPP_ACCESS_TOKEN the channel runs in dry-run mode (messages are logged, not sent), so the
// whole conversation can be exercised locally with scripts/test-whatsapp.js or signed curl requests.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createSender } = require('./send');
const { createWebhook, createAdmin } = require('./webhook');
const { SessionStore } = require('../session/store');
const { createEngine } = require('../session/engine');
const { DATA_DIR } = require('../kb');

const WEBHOOK_PATH = '/webhook/whatsapp';
const ADMIN_PATH = '/api/whatsapp/admin';

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));

function loadData() {
  return { org: readJson('org.json'), faqs: readJson('faqs.json'), menu: readJson('menu.json'), documents: readJson('documents.json'), complaints: readJson('complaints.json') };
}

// Optional webhook for the officer queue (HANDOVER_WEBHOOK_URL): fire and forget, 5 s cap.
async function postHandover(payload) {
  if (!config.handoverWebhook) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(config.handoverWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'whatsapp', at: new Date().toISOString(), ...payload }), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mountWhatsApp(app, { respond, data = loadData(), transport, stateDir = config.stateDir, persist = true } = {}) {
  const store = new SessionStore({ dir: path.resolve(stateDir), ttlMs: config.sessionTtlMs, persist, defaultLang: data.org.defaultLanguage });
  const engine = createEngine({ data, store, respond, assetsBase: config.assetsBase, handoverTtlMs: config.handoverTtlMs, onHandover: postHandover });
  const sender = createSender({ transport });
  app.use(WEBHOOK_PATH, createWebhook({ engine, sender, store }));
  app.use(ADMIN_PATH, createAdmin({ engine, sender, store }));
  const sweeper = setInterval(() => store.sweep(), 10 * 60 * 1000);
  sweeper.unref();
  const flush = () => store.flush();
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
  return { engine, store, sender, status: status() };
}

function status() {
  return {
    configured: config.configured,
    dryRun: config.dryRun,
    missing: config.missing,
    webhookPath: WEBHOOK_PATH,
    adminEnabled: Boolean(config.adminToken),
    phoneNumberId: config.phoneNumberId ? `…${config.phoneNumberId.slice(-4)}` : null,
  };
}

module.exports = { mountWhatsApp, loadData, status, WEBHOOK_PATH, ADMIN_PATH };
