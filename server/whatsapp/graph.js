// Minimal Meta Graph API client for the WhatsApp Cloud API: one endpoint, retries on 429 / 5xx,
// errors carry Meta's code and message. The access token never appears in logs or errors.
const config = require('./config');

const TIMEOUT_MS = 15000;
const RETRY_DELAYS = [500, 1500];

class GraphError extends Error {
  constructor(message, { status, code, subcode, fbtrace } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.fbtrace = fbtrace;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (status) => status === 429 || status >= 500;

async function attempt(url, body, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const e = json.error || {};
    throw new GraphError(`Graph API ${res.status}: ${e.message || 'request failed'}`,
      { status: res.status, code: e.code, subcode: e.error_subcode, fbtrace: e.fbtrace_id });
  } catch (err) {
    if (err.name === 'AbortError') throw new GraphError('Graph API timeout', { status: 504 });
    if (err instanceof GraphError) throw err;
    throw new GraphError(`Graph API network error: ${err.message}`, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

// 429 (rate limit) and 5xx are retried; 4xx (bad token, bad payload, 24-hour window) are not.
async function request(path, body, { method = 'POST' } = {}) {
  const url = `https://graph.facebook.com/${config.apiVersion}/${path}`;
  for (let i = 0; ; i++) {
    try {
      return await attempt(url, body, method);
    } catch (err) {
      if (i >= RETRY_DELAYS.length || !transient(err.status)) throw err;
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

// POST /<phone-number-id>/messages (outbound messages and read receipts share the endpoint)
function sendMessage(payload) {
  const base = payload.to ? { messaging_product: 'whatsapp', recipient_type: 'individual' } : { messaging_product: 'whatsapp' };
  return request(`${config.phoneNumberId}/messages`, { ...base, ...payload });
}

module.exports = { request, sendMessage, GraphError };
