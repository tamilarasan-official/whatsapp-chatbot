// Chat rendering: bubbles, ticks, typing indicator, cards, quick replies and the list sheet.
// All text goes through textContent / createTextNode, never innerHTML, so user and AI
// content cannot inject markup.

const SVG_NS = 'http://www.w3.org/2000/svg';
const TICK_PATH = 'M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z';
const SINGLE_TICK_PATH = 'M11.1 3.3l-.48-.37a.37.37 0 0 0-.5.06L4.57 9.88a.32.32 0 0 1-.48.03L1.9 7.77a.37.37 0 0 0-.52.01l-.42.43a.36.36 0 0 0 0 .51l3.26 3.19c.14.14.36.12.48-.03l6.28-8.05a.37.37 0 0 0-.07-.51z';

let chatEl;
let sheet;
let lastSide = null;
let typingEl = null;
let onAction = () => {};

export function initChat({ container, sheetEls, actionHandler }) {
  chatEl = container;
  sheet = sheetEls;
  onAction = actionHandler;
  sheet.close.addEventListener('click', closeSheet);
  sheet.backdrop.addEventListener('click', closeSheet);
}

export function clearChat() {
  chatEl.replaceChildren();
  lastSide = null;
  typingEl = null;
  closeSheet();
}

// ---------- DOM helpers ----------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svg(viewBox, d, attrs = {}) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

// Supports *bold* and http(s) or /assets links. Newlines are kept by CSS (pre-wrap).
export function richText(text) {
  const frag = document.createDocumentFragment();
  const pattern = /(\*[^*\n]+\*)|(https?:\/\/[^\s]+|\/assets\/[^\s]+)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) frag.append(text.slice(last, match.index));
    if (match[1]) frag.append(el('strong', { text: match[1].slice(1, -1) }));
    else frag.append(el('a', { href: match[2], target: '_blank', rel: 'noopener noreferrer', text: match[2] }));
    last = pattern.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function timeNow() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function scrollToEnd() {
  requestAnimationFrame(() => { chatEl.scrollTop = chatEl.scrollHeight; });
}

function append(node) {
  if (typingEl && typingEl.parentNode === chatEl) chatEl.insertBefore(node, typingEl);
  else chatEl.append(node);
  scrollToEnd();
  return node;
}

function msgRow(side) {
  const first = lastSide !== side;
  lastSide = side;
  return el('div', { class: `msg ${side}${first ? ' first' : ''}` });
}

function ticksSvg(state) {
  const icon = svg('0 0 16 15', state === 'sent' ? SINGLE_TICK_PATH : TICK_PATH, { class: 'ticks' });
  if (state === 'read') icon.classList.add('read');
  return icon;
}

function meta({ ticks, ai } = {}) {
  const m = el('span', { class: 'meta' });
  if (ai) m.append(el('span', { class: 'ai-tag', text: ai }));
  m.append(timeNow());
  if (ticks) m.append(ticksSvg(ticks));
  return m;
}

// ---------- Chips and notes ----------

export function addDateChip(label = 'Today') {
  lastSide = null;
  return append(el('div', { class: 'date-chip', text: label }));
}

export function addSystemNote(text, variant = '') {
  lastSide = null;
  return append(el('div', { class: `sys-note ${variant}` }, richText(text)));
}

// ---------- Messages ----------

// Outgoing (user) bubble. Returns a function to advance the ticks.
export function addUserMessage(text) {
  const row = msgRow('out');
  const m = meta({ ticks: 'sent' });
  row.append(el('div', { class: 'bubble' }, richText(text), m));
  append(row);
  const setTicks = (state) => {
    const old = m.querySelector('.ticks');
    if (old) old.replaceWith(ticksSvg(state));
  };
  setTimeout(() => setTicks('delivered'), 350);
  return setTicks;
}

/**
 * Incoming (bot) message.
 * opts: { text, cardNode, source: {title, url}, ai: 'AI' tag text,
 *         buttons: [{id, label}], list: {button, title, sections}, sender, variant }
 */
export function addBotMessage(opts) {
  const row = msgRow('in');
  const bubble = el('div', { class: `bubble${opts.wide ? ' wide' : ''}${opts.variant ? ' ' + opts.variant : ''}` });
  if (opts.sender) bubble.append(el('div', { class: 'template-title', style: 'color:#1f7aec', text: opts.sender }));
  if (opts.header) bubble.append(opts.header);
  if (opts.cardNode) bubble.append(opts.cardNode);
  if (opts.text) bubble.append(richText(opts.text));
  if (opts.source) bubble.append(linkPreview(opts.source));
  if (opts.footer) bubble.append(el('div', { class: 'template-footer', text: opts.footer }));
  bubble.append(meta({ ai: opts.ai }));
  row.append(bubble);
  if (opts.buttons?.length) row.append(quickReplies(opts.buttons));
  if (opts.list) row.append(listButton(opts.list));
  return append(row);
}

export function showTyping() {
  if (typingEl) return;
  typingEl = el('div', { class: 'msg in typing' + (lastSide !== 'in' ? ' first' : '') },
    el('div', { class: 'bubble' }, el('span', { class: 'dots' }, el('span'), el('span'), el('span'))));
  chatEl.append(typingEl);
  scrollToEnd();
}

export function hideTyping() {
  if (typingEl) typingEl.remove();
  typingEl = null;
}

// ---------- Interactive parts ----------

function quickReplies(buttons) {
  const group = el('div', { class: 'qr-group' });
  for (const b of buttons.slice(0, 3)) {
    group.append(el('button', {
      class: 'qr', type: 'button', text: b.label,
      onclick: () => {
        group.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        onAction(b.id, b.label);
      },
    }));
  }
  return group;
}

function listButton(list) {
  const wrap = el('div', { class: 'list-btn' });
  const icon = svg('0 0 24 24', 'M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z', { width: 18, height: 18 });
  wrap.append(el('button', { type: 'button', onclick: () => openSheet(list) }, icon, list.button));
  return wrap;
}

export function openSheet(list) {
  sheet.title.textContent = list.title;
  sheet.body.replaceChildren();
  for (const section of list.sections) {
    if (section.title) sheet.body.append(el('div', { class: 'sheet-section', text: section.title }));
    for (const row of section.rows) {
      sheet.body.append(el('button', {
        class: 'sheet-row', type: 'button',
        onclick: () => { closeSheet(); onAction(row.id, row.title); },
      },
      el('div', { class: 'row-text' },
        el('div', { class: 'row-title', text: row.title }),
        row.description ? el('div', { class: 'row-desc', text: row.description }) : null),
      el('span', { class: 'radio' })));
    }
  }
  sheet.backdrop.hidden = false;
  sheet.root.hidden = false;
}

export function closeSheet() {
  if (!sheet) return;
  sheet.backdrop.hidden = true;
  sheet.root.hidden = true;
}

// ---------- Cards ----------

export function linkPreview({ title, description, url }) {
  const domain = url.startsWith('/') ? 'sample-institute.example' : new URL(url).hostname;
  return el('a', { class: 'card-link', href: url, target: '_blank', rel: 'noopener noreferrer' },
    el('div', { class: 'link-title', text: title }),
    description ? el('div', { class: 'link-desc', text: description }) : null,
    el('div', { class: 'link-domain', text: domain }));
}

export function documentCard({ title, file, size, pages }) {
  const dl = svg('0 0 24 24', 'M12 16 7 11l1.4-1.4 2.6 2.6V4h2v8.2l2.6-2.6L17 11zm-6 4v-2h12v2z', { width: 18, height: 18 });
  return el('a', { class: 'card-doc', href: `/assets/${file}`, target: '_blank', rel: 'noopener', download: file },
    el('span', { class: 'pdf-icon', text: 'PDF' }),
    el('span', { class: 'doc-info' },
      el('div', { class: 'doc-name', text: `${title}.pdf` }),
      el('div', { class: 'doc-meta', text: `${pages} page${pages > 1 ? 's' : ''} · PDF · ${size}` })),
    el('span', { class: 'doc-dl' }, dl));
}

export function statusCard(app, labels) {
  return el('div', { class: 'card-status' },
    el('div', { class: 'status-head' },
      el('span', { class: 'status-ref', text: app.ref }),
      el('span', { class: `status-chip ${app.statusKey}`, text: app.statusLabel })),
    el('dl', { class: 'status-rows' },
      el('dt', { text: labels.applicant }), el('dd', { text: app.applicant }),
      el('dt', { text: labels.updated }), el('dd', { text: app.updated }),
      el('dt', { text: labels.next }), el('dd', { text: app.nextStep })));
}

export function imageCard(src, alt) {
  return el('img', { class: 'card-image', src, alt, width: 480, height: 300, loading: 'lazy' });
}

export function templateHeader(label, title) {
  const icon = svg('0 0 24 24', 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z', { width: 12, height: 12, fill: 'currentColor' });
  return el('div', {},
    el('div', { class: 'template-label' }, icon, label),
    el('div', { class: 'template-title', text: title }));
}
