// Turns a Cloud API webhook body into flat inbound events. Everything not understood is kept as
// { type } only, so the engine can answer "text only, please" instead of crashing.

const TEXT_TYPES = new Set(['text', 'interactive', 'button']);

function parseMessage(m, contacts) {
  const base = {
    id: String(m.id || ''),
    from: String(m.from || ''),
    name: contacts.find((c) => c.wa_id === m.from)?.profile?.name || '',
    timestamp: Number(m.timestamp) * 1000 || Date.now(),
    type: m.type || 'unknown',
    text: '',
    replyId: null,
    replyTitle: null,
  };
  if (m.type === 'text') return { ...base, text: String(m.text?.body || '').trim() };
  if (m.type === 'interactive') {
    const r = m.interactive?.button_reply || m.interactive?.list_reply || {};
    const title = String(r.title || '').trim();
    return { ...base, replyId: r.id ? String(r.id) : null, replyTitle: title, text: title };
  }
  if (m.type === 'button') { // quick-reply button on an approved template
    const title = String(m.button?.text || '').trim();
    return { ...base, replyId: m.button?.payload ? String(m.button.payload) : null, replyTitle: title, text: title };
  }
  return base;
}

// Returns { messages, statuses }. Messages are sorted by timestamp (Meta may batch out of order).
function parseWebhook(body) {
  const messages = [];
  const statuses = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (value.messaging_product && value.messaging_product !== 'whatsapp') continue;
      const contacts = value.contacts || [];
      for (const m of value.messages || []) messages.push(parseMessage(m, contacts));
      for (const s of value.statuses || []) statuses.push({ id: s.id, status: s.status, recipient: s.recipient_id, errors: s.errors });
    }
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return { messages, statuses };
}

const isTextLike = (msg) => TEXT_TYPES.has(msg.type);

module.exports = { parseWebhook, isTextLike };
