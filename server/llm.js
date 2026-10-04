const Anthropic = require('@anthropic-ai/sdk');
const { org, faqs, faqIds } = require('./kb');
const { buildSystemPrompt } = require('./prompt');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 8000;
const MAX_HISTORY = 8;

const INTENTS = new Set([
  'faq', 'status', 'appointment', 'document', 'grievance',
  'feedback', 'handover', 'out_of_scope', 'smalltalk',
]);
const LANGUAGES = new Set(['en', 'hi', 'ta', 'mixed']);

const SYSTEM_PROMPT = buildSystemPrompt(org, faqs);
const KNOWN_IDS = faqIds();

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  }
  return client;
}

// Keep the last N turns, drop junk, merge same-role neighbours and make sure
// the list starts with a user message (the Messages API requires alternation).
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const items = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 1000).trim() }))
    .filter((m) => m.content)
    .slice(-MAX_HISTORY);

  const merged = [];
  for (const m of items) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}

function buildMessages(message, history) {
  const messages = cleanHistory(history);
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') last.content += '\n' + message;
  else messages.push({ role: 'user', content: message });
  return messages;
}

function extractJson(text) {
  const stripped = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(stripped.slice(start, end + 1));
}

function normalise(raw, fallbackLang) {
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new Error('Empty reply');
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence)));
  return {
    reply,
    language: LANGUAGES.has(raw.language) ? raw.language : fallbackLang,
    intent: INTENTS.has(raw.intent) ? raw.intent : 'smalltalk',
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s) => KNOWN_IDS.has(s)) : [],
    escalate: Boolean(raw.escalate),
    suggested_replies: Array.isArray(raw.suggested_replies)
      ? raw.suggested_replies.map((s) => String(s).slice(0, 20)).filter(Boolean).slice(0, 3)
      : [],
  };
}

async function callModel(messages, signal) {
  const res = await getClient().messages.create(
    { model: MODEL, max_tokens: 500, temperature: 0.2, system: SYSTEM_PROMPT, messages },
    { signal },
  );
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Calls Claude, parses the JSON reply and retries once if parsing fails.
async function chat({ message, history, language }) {
  if (!getClient()) throw new LlmError('ANTHROPIC_API_KEY is not set', 503);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const messages = buildMessages(message, history);

  try {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await callModel(messages, controller.signal);
      try {
        const result = normalise(extractJson(text), language || 'en');
        return { ...result, latency_ms: Date.now() - started };
      } catch (err) {
        lastError = err;
      }
    }
    throw new LlmError(`Unparseable model output: ${lastError.message}`, 502);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (controller.signal.aborted) throw new LlmError('LLM timeout', 504);
    throw new LlmError(`LLM request failed: ${err.status || ''} ${err.message}`.trim(), 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, MODEL, LlmError };
