// WhatsApp Cloud API size limits and grapheme-safe clipping (Hindi matras must never be cut in half).
// Limits from Meta's Cloud API reference for text, interactive (buttons / list) and document messages.

const LIMITS = {
  TEXT_BODY: 4096,
  INTERACTIVE_BODY: 1024,
  HEADER_TEXT: 60,
  FOOTER: 60,
  BUTTONS: 3,
  BUTTON_TITLE: 20,
  BUTTON_ID: 256,
  LIST_BUTTON: 20,
  LIST_SECTIONS: 10,
  LIST_ROWS: 10,
  SECTION_TITLE: 24,
  ROW_TITLE: 24,
  ROW_DESCRIPTION: 72,
  ROW_ID: 200,
  CAPTION: 1024,
  FILENAME: 240,
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s) => Array.from(segmenter.segment(s), (g) => g.segment);

// Meta counts UTF-16 code units. Cut on grapheme boundaries so a trailing matra is never orphaned.
function clip(value, max, ellipsis = '…') {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let out = '';
  for (const g of graphemes(s)) {
    if (out.length + g.length > max - ellipsis.length) break;
    out += g;
  }
  return out.trimEnd() + ellipsis;
}

// Split a long text into chunks of at most `max` code units, preferring paragraph, then line, then space breaks.
function splitText(value, max = LIMITS.TEXT_BODY) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    if (cut < max * 0.5) cut = graphemes(window).slice(0, -1).join('').length; // no break: cut on a grapheme
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Validation used by the tests and the sender: returns a list of problems (empty = within limits).
function violations(msg) {
  const out = [];
  const over = (label, s, max) => { if (String(s ?? '').length > max) out.push(`${label} > ${max}`); };
  const empty = (label, s) => { if (!String(s ?? '').trim()) out.push(`${label} empty`); };
  switch (msg.type) {
    case 'text':
      empty('text', msg.text); over('text', msg.text, LIMITS.TEXT_BODY); break;
    case 'buttons': {
      const buttons = msg.buttons || [];
      empty('body', msg.text); over('body', msg.text, LIMITS.INTERACTIVE_BODY);
      if (!buttons.length || buttons.length > LIMITS.BUTTONS) out.push(`buttons count ${buttons.length}`);
      for (const b of buttons) {
        empty('button title', b.title); over(`button "${b.title}"`, b.title, LIMITS.BUTTON_TITLE); over('button id', b.id, LIMITS.BUTTON_ID);
      }
      if (new Set(buttons.map((b) => b.id)).size !== buttons.length) out.push('duplicate button id');
      break;
    }
    case 'list': {
      const sections = msg.sections || [];
      const rows = sections.flatMap((s) => s.rows || []);
      empty('body', msg.text); over('body', msg.text, LIMITS.INTERACTIVE_BODY);
      empty('list button', msg.button); over('list button', msg.button, LIMITS.LIST_BUTTON);
      if (!rows.length || rows.length > LIMITS.LIST_ROWS) out.push(`rows count ${rows.length}`);
      if (sections.length > LIMITS.LIST_SECTIONS) out.push('too many sections');
      for (const s of sections) over('section title', s.title, LIMITS.SECTION_TITLE);
      for (const r of rows) {
        empty('row title', r.title); over(`row "${r.title}"`, r.title, LIMITS.ROW_TITLE);
        over('row description', r.description, LIMITS.ROW_DESCRIPTION); over('row id', r.id, LIMITS.ROW_ID);
      }
      if (new Set(rows.map((r) => r.id)).size !== rows.length) out.push('duplicate row id');
      break;
    }
    case 'document':
      empty('link', msg.link); over('caption', msg.caption, LIMITS.CAPTION); over('filename', msg.filename, LIMITS.FILENAME); break;
    case 'template':
      empty('template name', msg.name); break;
    default:
      out.push(`unknown type ${msg.type}`);
  }
  return out;
}

module.exports = { LIMITS, clip, splitText, violations, graphemes };
