// Outbound WhatsApp messages. The engine produces abstract messages
//   { type: 'text', text } | { type: 'buttons', text, buttons:[{id,title}], short? }
//   { type: 'list', text, button, sections:[{title, rows:[{id,title,description}]}], short? }
//   { type: 'document', link, filename, caption } | { type: 'template', name, language, components }
// and this module turns them into Cloud API payloads within Meta's limits: long bodies are split,
// titles clipped on grapheme boundaries, button and row counts capped. `short` is the body used for the
// buttons / list message when the text itself had to go out as a separate text message.
const config = require('./config');
const graph = require('./graph');
const { LIMITS, clip, splitText } = require('./limits');

const hasUrl = (s) => /https?:\/\//i.test(s);
const textPayload = (to, body) => ({ to, type: 'text', text: { preview_url: hasUrl(body), body } });

function bodyAndPrefix(to, msg) {
  // Interactive bodies hold 1024 chars: anything longer goes out as text first, then a short interactive body.
  if (msg.text.length <= LIMITS.INTERACTIVE_BODY) return { prefix: [], body: msg.text };
  return { prefix: splitText(msg.text).map((t) => textPayload(to, t)), body: msg.short || '👇' };
}

function buttonsPayload(to, msg) {
  const { prefix, body } = bodyAndPrefix(to, msg);
  const buttons = msg.buttons.slice(0, LIMITS.BUTTONS).map((b) => ({
    type: 'reply', reply: { id: clip(b.id, LIMITS.BUTTON_ID, ''), title: clip(b.title, LIMITS.BUTTON_TITLE) },
  }));
  return [...prefix, { to, type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons } } }];
}

function listPayload(to, msg) {
  const { prefix, body } = bodyAndPrefix(to, msg);
  let budget = LIMITS.LIST_ROWS;
  const sections = msg.sections.slice(0, LIMITS.LIST_SECTIONS).map((s) => {
    const rows = (s.rows || []).slice(0, budget).map((r) => {
      const row = { id: clip(r.id, LIMITS.ROW_ID, ''), title: clip(r.title, LIMITS.ROW_TITLE) };
      if (r.description) row.description = clip(r.description, LIMITS.ROW_DESCRIPTION);
      return row;
    });
    budget -= rows.length;
    return s.title ? { title: clip(s.title, LIMITS.SECTION_TITLE), rows } : { rows };
  }).filter((s) => s.rows.length);
  const action = { button: clip(msg.button, LIMITS.LIST_BUTTON), sections };
  return [...prefix, { to, type: 'interactive', interactive: { type: 'list', body: { text: body }, action } }];
}

function toPayloads(to, msg) {
  switch (msg.type) {
    case 'text': return splitText(msg.text).map((t) => textPayload(to, t));
    case 'buttons': return buttonsPayload(to, msg);
    case 'list': return listPayload(to, msg);
    case 'document': {
      const document = { link: msg.link };
      if (msg.filename) document.filename = clip(msg.filename, LIMITS.FILENAME, '');
      if (msg.caption) document.caption = clip(msg.caption, LIMITS.CAPTION);
      return [{ to, type: 'document', document }];
    }
    case 'template':
      return [{ to, type: 'template', template: { name: msg.name, language: { code: msg.language || 'en' }, components: msg.components || [] } }];
    default:
      throw new Error(`Unknown outbound message type: ${msg.type}`);
  }
}

// Dry run: print what would be sent. Used locally and whenever WHATSAPP_ACCESS_TOKEN is missing.
function dryTransport(log) {
  let n = 0;
  return async (payload) => {
    n += 1;
    if (payload.status) { log(`[wa:dry] ${payload.status} ${payload.message_id}${payload.typing_indicator ? ' (typing)' : ''}`); return { success: true }; }
    const i = payload.interactive;
    const summary = payload.type === 'text' ? payload.text.body
      : payload.type === 'interactive' ? `${i.body.text}  [${i.type}: ${(i.action.buttons || i.action.sections.flatMap((s) => s.rows)).map((b) => b.reply?.title || b.title).join(' | ')}]`
        : payload.type === 'document' ? `[document] ${payload.document.filename} ${payload.document.link}`
          : payload.type === 'template' ? `[template] ${payload.template.name}` : `[${payload.type}]`;
    log(`[wa:dry] -> ${payload.to}: ${summary.replace(/\n/g, ' / ')}`);
    return { messages: [{ id: `dry.${n}` }] };
  };
}

function createSender({ transport, log = console.log } = {}) {
  const send = transport || (config.dryRun ? dryTransport(log) : graph.sendMessage);

  // Sends every message in order; one failure is logged and does not stop the rest. Returns Meta message ids.
  async function deliver(to, messages) {
    const ids = [];
    for (const msg of messages) {
      for (const payload of toPayloads(to, msg)) {
        try {
          const res = await send(payload);
          ids.push(res?.messages?.[0]?.id || null);
        } catch (err) {
          console.warn(`[wa] send failed to ${to} (${payload.type}): ${err.message}${err.code ? ` code=${err.code}` : ''}`);
          ids.push(null);
        }
      }
    }
    return ids;
  }

  // Blue ticks plus the typing indicator while the answer is prepared. Failures are ignored.
  async function markRead(messageId, { typing = true } = {}) {
    if (!messageId) return;
    const payload = { status: 'read', message_id: messageId };
    if (typing) payload.typing_indicator = { type: 'text' };
    try { await send(payload); } catch (err) { console.warn(`[wa] mark read failed: ${err.message}`); }
  }

  return { deliver, markRead, send, toPayloads };
}

module.exports = { createSender, toPayloads };
