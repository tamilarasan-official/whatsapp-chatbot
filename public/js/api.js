// Fetch wrapper for the backend. Any non-200, timeout or network error resolves to
// { ok: false } so the caller can show the scripted fallback.

const CHAT_TIMEOUT_MS = 9000; // server LLM timeout is 8 s; allow a little network overhead

async function fetchJson(url, options = {}, timeoutMs = CHAT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, latency: Math.round(performance.now() - started) };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      error: timedOut ? `timeout after ${timeoutMs / 1000}s` : 'network error',
      latency: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function postChat(message, history, language, context) {
  return fetchJson('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, language, context }),
  });
}

export function getApplication(ref) {
  return fetchJson(`/api/application/${encodeURIComponent(ref)}`, {}, 4000);
}

export function getHealth() {
  return fetchJson('/api/health', {}, 3000);
}

export async function loadData() {
  const names = ['org', 'faqs', 'applications', 'slots', 'documents'];
  const results = await Promise.all(names.map((n) => fetch(`/data/${n}.json`).then((r) => r.json())));
  return Object.fromEntries(names.map((n, i) => [n, results[i]]));
}
