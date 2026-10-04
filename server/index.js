require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { DATA_DIR, faqs, findApplication } = require('./kb');
const { chat, MODEL } = require('./llm');
const { fallbackReply } = require('./fallback');

const PORT = Number(process.env.PORT) || 3000;
const MAX_MESSAGE_LENGTH = 500;
const VALID_LANGS = new Set(['en', 'hi', 'ta']);

const app = express();
app.disable('x-powered-by');
app.use(cors());
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, kbItems: faqs.length, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.get('/api/application/:ref', (req, res) => {
  const application = findApplication(req.params.ref);
  if (!application) return res.status(404).json({ error: 'not_found' });
  res.json(application);
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const language = VALID_LANGS.has(req.body?.language) ? req.body.language : 'en';

  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'invalid_message', ...fallbackReply(language, 'invalid_message') });
  }

  try {
    const result = await chat({ message, history: req.body.history, language });
    console.log(`[chat] ${result.intent} ${result.language} conf=${result.confidence} ${result.latency_ms}ms`);
    res.json(result);
  } catch (err) {
    const status = err.status || 502;
    console.warn(`[chat] failed (${status}): ${err.message}`);
    res.status(status).json({ error: 'llm_unavailable', ...fallbackReply(language, err.message) });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Dummy JSON data is read-only and safe to serve; the browser flow engine uses it.
app.use('/data', express.static(DATA_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Could not start server on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`WhatsApp AI demo running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL} | KB items: ${faqs.length} | AI ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'DISABLED (no ANTHROPIC_API_KEY, fallback only)'}`);
});
