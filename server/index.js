require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { DATA_DIR, findComplaint } = require('./kb');
const { MODEL } = require('./llm');
const { respond } = require('./answer');
const search = require('./search');
const { fallbackReply } = require('./fallback');

const PORT = Number(process.env.PORT) || 3000;
const MAX_MESSAGE_LENGTH = 500;
const VALID_LANGS = new Set(['en', 'hi']);

const app = express();
app.disable('x-powered-by');
// Behind Dokploy/Traefik (or any reverse proxy) so rate limiting sees the real client IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
// CORS_ORIGIN: comma-separated list of allowed frontend origins (e.g. https://valardemo.welocalhost.com).
// Unset = allow any origin (local development).
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50kb' }));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MIN) || 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'rate_limited', ...fallbackReply(req.body?.language, 'rate_limited') });
  },
});

// Only short, known fields from the browser's flow state are passed to the prompt.
function sanitiseContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return {};
  const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  return {
    ticket: str(ctx.ticket, 20),
    audience: ctx.audience === 'officials' ? 'officials' : undefined,
    replyLanguage: VALID_LANGS.has(ctx.replyLanguage) ? ctx.replyLanguage : undefined,
    optedOut: ctx.optedOut === true,
    // ids of the previous answer's sources: FAQ ids ("municipal_09") or section keys ("municipal_act:14")
    prevSources: Array.isArray(ctx.prevSources)
      ? ctx.prevSources.filter((s) => typeof s === 'string' && /^[a-z0-9_]{1,40}(?::[\w-]{1,40})?$/i.test(s)).slice(0, 4)
      : [],
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true, provider: 'openai', model: MODEL, aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    kb: { faqs: search.faqs.length, sections: search.sectionsByKey.size, embedding: search.meta.model },
  });
});

// Dummy complaint records (CMP-YYYY-NNNNN) for the complaint-status demo flow.
app.get('/api/complaint/:ref', (req, res) => {
  const complaint = findComplaint(req.params.ref);
  if (!complaint) return res.status(404).json({ error: 'not_found' });
  res.json(complaint);
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const language = VALID_LANGS.has(req.body?.language) ? req.body.language : 'hi';

  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'invalid_message', ...fallbackReply(language, 'invalid_message') });
  }

  try {
    const mode = req.body?.mode === 'ai' ? 'ai' : 'static';
    const context = sanitiseContext(req.body.context);
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const result = await respond({ message, history, language, context, mode });
    console.log(`[chat] ${mode} ${result.route} ${result.intent}/${result.action} ${result.language} conf=${result.confidence} `
      + `cites=${result.citations.map((c) => c.faq_id || c.key).join('|') || '-'} ${result.latency_ms}ms`);
    res.json(result);
  } catch (err) {
    const status = err.status || 502;
    console.warn(`[chat] failed (${status}): ${err.message}`);
    res.status(status).json({ error: 'llm_unavailable', ...fallbackReply(language, err.message) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// SERVE_STATIC=false when the UI is served by the separate frontend container (API-only backend).
if (process.env.SERVE_STATIC !== 'false') {
  // Only the top-level JSON files (org, FAQs, menu, documents, dummy complaints) are served;
  // data/kb (search index and the 118 MB model) stays server-side.
  app.use('/data', (req, res, next) => (/^\/[\w-]+\.json$/.test(req.path) ? next() : res.status(404).end()),
    express.static(DATA_DIR, { index: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
} else {
  app.get('/', (req, res) => res.json({ service: 'whatsapp-ai-demo-api', health: '/api/health' }));
}

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Could not start server on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`WhatsApp AI demo running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL} | KB: ${search.faqs.length} FAQs, ${search.sectionsByKey.size} sections | AI ${process.env.OPENAI_API_KEY ? 'enabled (OpenAI)' : 'DISABLED (no OPENAI_API_KEY, official FAQ answers only)'}`);
  // Load the embedding model now so the first question is not slow.
  const t = performance.now();
  search.loadModel()
    .then(() => console.log(`Search model ${search.meta.model} loaded in ${Math.round(performance.now() - t)} ms`))
    .catch((err) => console.error(`Search model failed to load: ${err.message}`));
});
