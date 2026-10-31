// OpenAI calls used by the answer engine: query rewriting and the final grounded answer (JSON mode).
const OpenAI = require('openai');
const { buildAnswerPrompt, REWRITE_PROMPT } = require('./prompt');

// gpt-5.4-mini: in the Phase 5 test it made a third of gpt-4.1-mini's meaning errors on Act answers.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
// GPT-5 / o-series are reasoning models: no temperature, max_completion_tokens, and a reasoning effort.
const REASONING = /^(gpt-5|o\d)/.test(MODEL);
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'low';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 10000;
const REWRITE_TIMEOUT_MS = 4000; // x3 for reasoning models
const MAX_HISTORY = 30;

const INTENTS = new Set(['faq', 'act', 'evoting', 'complaint', 'handover', 'out_of_scope', 'smalltalk']);
const LANGUAGES = new Set(['en', 'hi', 'ta', 'mixed']);
const ACTIONS = new Set(['none', 'menu', 'faq_list', 'grievance', 'handover']);

class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  return client;
}

// Keep the last N messages, drop junk and merge same-role neighbours.
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
  return merged;
}

function withUserMessage(system, history, message) {
  const messages = [{ role: 'system', content: system }, ...cleanHistory(history)];
  const last = messages[messages.length - 1];
  if (last.role === 'user') last.content += '\n' + message;
  else messages.push({ role: 'user', content: message });
  return messages;
}

function extractJson(text) {
  const stripped = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) throw new LlmError('Unparseable model output: no JSON object', 502);
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch (err) {
    throw new LlmError(`Unparseable model output: ${err.message}`, 502);
  }
}

async function completeJson(messages, { maxTokens, temperature, timeoutMs }) {
  if (!getClient()) throw new LlmError('OPENAI_API_KEY is not set', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text;
  try {
    const res = await getClient().chat.completions.create(
      {
        model: MODEL, messages, response_format: { type: 'json_object' },
        ...(REASONING
          ? { max_completion_tokens: maxTokens * 4, reasoning_effort: REASONING_EFFORT } // room for reasoning tokens
          : { max_tokens: maxTokens, temperature }),
      },
      { signal: controller.signal },
    );
    text = res.choices[0]?.message?.content;
  } catch (err) {
    if (controller.signal.aborted) throw new LlmError('LLM timeout', 504);
    throw new LlmError(`LLM request failed: ${err.status || ''} ${err.message}`.trim(), 502);
  } finally {
    clearTimeout(timer);
  }
  return extractJson(text);
}

// Standalone Hindi + English search queries for a Hinglish / follow-up message. Returns [] on any failure.
async function rewriteQuery(message, history) {
  try {
    const recent = cleanHistory(history).slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 300)}`).join('\n');
    const user = `${recent ? `Earlier chat:\n${recent}\n\n` : ''}Last message: ${message}`;
    const out = await completeJson([{ role: 'system', content: REWRITE_PROMPT }, { role: 'user', content: user }],
      { maxTokens: 160, temperature: 0, timeoutMs: REWRITE_TIMEOUT_MS * (REASONING ? 3 : 1) });
    return [out.hi, out.en].map((s) => String(s || '').trim().slice(0, 300)).filter(Boolean);
  } catch (err) {
    console.warn(`[rewrite] skipped: ${err.message}`);
    return [];
  }
}

function normalise(raw, fallbackLang, validIds) {
  const reply = String(raw.reply || '').trim();
  if (!reply) throw new LlmError('Empty reply', 502);
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence)));
  return {
    reply,
    language: LANGUAGES.has(raw.language) ? raw.language : fallbackLang,
    intent: INTENTS.has(raw.intent) ? raw.intent : 'smalltalk',
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    // citations the server did not provide are dropped
    citationIds: Array.isArray(raw.citations) ? [...new Set(raw.citations.map(String))].filter((id) => validIds.has(id)) : [],
    escalate: Boolean(raw.escalate),
    action: ACTIONS.has(raw.action) ? raw.action : 'none',
    suggested_replies: Array.isArray(raw.suggested_replies)
      ? raw.suggested_replies.map((s) => String(s).trim()).filter((s) => s && s.length <= 30).slice(0, 3)
      : [],
  };
}

// Grounded answer. `note` is an extra system instruction for a retry (e.g. unsupported numbers).
async function answer({ message, history, language, context, mode, sources, validIds, note }) {
  let system = buildAnswerPrompt({ sources, language, context, mode });
  if (note) system += `\n\nCORRECTION FOR THIS REPLY\n${note}`;
  const messages = withUserMessage(system, history, message);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await completeJson(messages, { maxTokens: 500, temperature: 0.3, timeoutMs: TIMEOUT_MS });
      const result = normalise(raw, language, validIds);
      if (mode === 'ai' && result.action !== 'handover') result.action = 'none'; // AI mode has no built-in screens
      return result;
    } catch (err) {
      lastError = err;
      // retry bad output, and a timeout once: occasional API calls stall for 20 s+ while most take ~1.5 s
      if (!/Unparseable|Empty|timeout/.test(err.message)) break;
    }
  }
  throw lastError;
}

module.exports = { MODEL, LlmError, getClient, rewriteQuery, answer };
