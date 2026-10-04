// WhatsApp-style home screen (chat list). The Election Commission of India chat is pinned on top
// and mirrors the live conversation (last message, typing…, unread count). Other chats are decoration.

import { el } from './chat.js';

const OTHER_CHATS = [
  { name: 'Amma', color: '#e57373', msg: 'Saapteengala? 🍛', time: '9:41 pm', unread: 2 },
  { name: 'Family Group 👨‍👩‍👧‍👦', initials: 'FG', color: '#7986cb', msg: 'Ravi: Photos from the wedding 📷', time: '9:12 pm', unread: 12 },
  { name: 'Rahul Sharma', color: '#4db6ac', msg: 'Bro, match at 7 tomorrow?', time: '8:30 pm', read: true },
  { name: 'Office Team', color: '#ffb74d', msg: 'Priya: Meeting moved to 11 AM', time: '7:55 pm', unread: 3 },
  { name: 'Ananya', color: '#ba68c8', msg: '📷 Photo', time: 'Yesterday', read: true },
  { name: 'Cricket Gang 🏏', initials: 'CG', color: '#81c784', msg: 'Karthik: What a finish!! 🔥', time: 'Yesterday' },
  { name: 'Landlord', color: '#90a4ae', msg: 'Rent received, thanks 🙏', time: 'Monday', read: true },
  { name: 'Deepak (Electrician)', color: '#a1887f', msg: 'Will come by 10 am', time: 'Sunday' },
  { name: 'College Friends', initials: 'CF', color: '#64b5f6', msg: 'Sneha: Reunion plan 🎉', time: '02/10/26' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(viewBox, d, cls) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

const VERIFIED = () => {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'cl-verified');
  s.innerHTML = '<path fill="#25D366" d="m12 1 2.6 2 3.3-.2.9 3.2 2.8 1.8-1.2 3.2 1.2 3.2-2.8 1.8-.9 3.2-3.3-.2L12 23l-2.6-2-3.3.2-.9-3.2-2.8-1.8 1.2-3.2L2.4 9.8l2.8-1.8.9-3.2 3.3.2z"/><path fill="#fff" d="m10.6 15.6-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4z"/>';
  return s;
};
const PIN = () => icon('0 0 24 24', 'M16 3v2h-1v6l2 3v2h-4v5l-1 1-1-1v-5H7v-2l2-3V5H8V3z', 'cl-pin');
const TICKS = (read) => {
  const s = icon('0 0 16 15', 'M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z', 'cl-ticks');
  if (read) s.classList.add('read');
  return s;
};

function initialsOf(name) {
  return name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function initHome({ phone, homeView, chatList, chatEl, navBadge, orgName, onOtherChat }) {
  let unread = 0;
  let preview = { text: '', time: '', fromUser: false };
  let typing = false;

  const isHome = () => !homeView.hidden;

  function eciRow() {
    const nameRow = el('div', { class: 'cl-top' },
      el('span', { class: 'cl-name' }, el('span', { text: orgName }), VERIFIED()),
      el('span', { class: `cl-time${unread ? ' unread' : ''}`, text: preview.time }));
    const msg = typing
      ? el('span', { class: 'cl-msg typing', text: 'typing…' })
      : el('span', { class: 'cl-msg' }, preview.fromUser ? TICKS(true) : null, preview.text || 'Tap to chat');
    const right = el('span', { class: 'cl-right' }, unread ? el('b', { class: 'cl-badge', text: String(unread) }) : PIN());
    return el('li', {},
      el('button', { class: 'cl-row eci', type: 'button', onclick: openChat, 'aria-label': `Open chat with ${orgName}` },
        el('span', { class: 'cl-avatar logo' }, el('img', { src: 'assets/eci-logo.svg', alt: '', width: 40, height: 40 })),
        el('span', { class: 'cl-body' }, nameRow, el('div', { class: 'cl-bottom' }, msg, right))));
  }

  function otherRow(c) {
    return el('li', {},
      el('button', { class: 'cl-row', type: 'button', onclick: () => onOtherChat(c.name) },
        el('span', { class: 'cl-avatar', style: `background:${c.color}`, text: c.initials || initialsOf(c.name) }),
        el('span', { class: 'cl-body' },
          el('div', { class: 'cl-top' },
            el('span', { class: 'cl-name', text: c.name }),
            el('span', { class: `cl-time${c.unread ? ' unread' : ''}`, text: c.time })),
          el('div', { class: 'cl-bottom' },
            el('span', { class: 'cl-msg' }, c.read ? TICKS(true) : null, c.msg),
            c.unread ? el('span', { class: 'cl-right' }, el('b', { class: 'cl-badge', text: String(c.unread) })) : null))));
  }

  function render() {
    chatList.replaceChildren(eciRow(), ...OTHER_CHATS.map(otherRow));
    const total = unread + OTHER_CHATS.filter((c) => c.unread).length;
    navBadge.textContent = String(total);
    navBadge.hidden = total === 0;
  }

  function openChat() {
    unread = 0;
    homeView.hidden = true;
    phone.classList.remove('on-home');
    chatEl.scrollTop = chatEl.scrollHeight;
    render();
  }

  function showHome() {
    homeView.hidden = false;
    phone.classList.add('on-home');
    render();
  }

  // Mirror the live chat: last message preview, typing indicator and unread count.
  function textOf(msgNode) {
    const bubble = msgNode.querySelector('.bubble');
    if (!bubble) return '';
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll('.meta, .card-link, .template-label, .template-title, .template-footer, .status-rows').forEach((n) => n.remove());
    if (clone.querySelector('.card-doc')) return '📄 Document';
    if (clone.querySelector('.card-image')) return '📷 Photo';
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  new MutationObserver((records) => {
    let changed = false;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.classList.contains('msg')) continue;
        if (node.classList.contains('typing')) { typing = true; changed = true; continue; }
        preview = { text: textOf(node), time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(), fromUser: node.classList.contains('out') };
        if (isHome() && node.classList.contains('in')) unread += 1;
        changed = true;
      }
      for (const node of r.removedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('typing')) { typing = false; changed = true; }
      }
    }
    if (changed && isHome()) render();
  }).observe(chatEl, { childList: true });

  render();
  return { showHome, openChat, reset() { unread = 0; preview = { text: '', time: '', fromUser: false }; typing = false; render(); } };
}
