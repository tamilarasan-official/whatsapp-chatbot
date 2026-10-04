// Behind the Scenes log, mini dashboard and Agent view. Text is set via textContent only.

import { el } from './chat.js';

const LANG_LABELS = { en: 'English', hi: 'Hindi', ta: 'Tamil', mixed: 'Hinglish' };
const ROUTE_LABELS = { ai: 'Live AI', scripted: 'Scripted flow', fallback: 'Fallback', offline: 'Offline match' };

let els;
let stats;

export function initPanels(elements) {
  els = elements;
  reset();
}

export function reset() {
  stats = { queries: 0, resolved: 0, escalations: 0, ai: 0, intents: {} };
  els.btsList.replaceChildren();
  els.btsEmpty.hidden = false;
  closeAgent();
  els.agentState.textContent = 'Waiting for handover';
  els.agentState.className = 'agent-state';
  els.agentEmpty.hidden = false;
  els.agentBody.hidden = true;
  els.agentTranscript.replaceChildren();
  renderStats();
}

export function setPresence(text) {
  els.presence.textContent = text;
}

// ---------- Behind the scenes ----------

function confidenceNode(value) {
  if (value == null) return el('span', { class: 'muted', text: '–' });
  const pct = Math.round(value * 100);
  const level = value < 0.5 ? ' low' : value < 0.75 ? ' mid' : '';
  return el('span', { class: 'conf' },
    el('span', { class: `conf-bar${level}` }, el('span', { style: `width:${pct}%` })),
    `${value.toFixed(2)}`);
}

export function log(entry) {
  const routeClass = entry.route === 'ai' ? 'ai' : entry.route === 'fallback' ? 'fallback' : 'scripted';
  const tags = [el('span', { class: `tag route-${entry.route === 'ai' ? 'ai' : 'scripted'}`, text: ROUTE_LABELS[entry.route] || entry.route })];
  for (const tag of entry.tags || []) {
    const bad = /fallback|low confidence|escalat|suppressed|not found/.test(tag);
    tags.push(el('span', { class: `tag ${bad ? 'bad' : 'warn'}`, text: tag }));
  }

  const latency = entry.latency == null ? (entry.route === 'ai' ? '–' : 'instant (local)') : `${entry.latency} ms`;
  const sources = entry.sources?.length ? entry.sources.join(', ') : 'none';

  const item = el('li', { class: `bts-item ${routeClass}` },
    el('div', { class: 'bts-q', title: entry.query, text: `“${entry.query}”` }),
    el('div', { class: 'bts-tags' }, tags),
    el('dl', { class: 'bts-grid' },
      el('dt', { text: 'Language' }), el('dd', { text: LANG_LABELS[entry.language] || entry.language || '–' }),
      el('dt', { text: 'Intent' }), el('dd', { text: entry.intent || '–' }),
      el('dt', { text: 'Confidence' }), el('dd', {}, confidenceNode(entry.confidence)),
      el('dt', { text: 'Sources' }), el('dd', { text: sources }),
      el('dt', { text: 'Latency' }), el('dd', { text: latency }),
      entry.label ? el('dt', { text: 'Note' }) : null,
      entry.label ? el('dd', { text: entry.label }) : null));

  els.btsList.append(item);
  els.btsEmpty.hidden = true;
  const max = 40;
  while (els.btsList.children.length > max) els.btsList.firstChild.remove();
  els.btsList.parentElement.scrollTop = 0;
}

// ---------- Dashboard ----------

export function recordQuery({ intent, resolved = false, escalated = false, ai = false }) {
  stats.queries += 1;
  if (resolved) stats.resolved += 1;
  if (escalated) stats.escalations += 1;
  if (ai) stats.ai += 1;
  if (intent) stats.intents[intent] = (stats.intents[intent] || 0) + 1;
  renderStats(true);
}

function bump(node, value) {
  if (node.textContent === String(value)) return;
  node.textContent = value;
  node.classList.add('bump');
  setTimeout(() => node.classList.remove('bump'), 500);
}

function renderStats(animate) {
  const set = animate ? bump : (node, v) => { node.textContent = v; };
  set(els.kpiConv, stats.queries);
  set(els.kpiResolved, stats.queries ? `${Math.round((stats.resolved / stats.queries) * 100)}%` : '–');
  set(els.kpiEsc, stats.escalations);
  set(els.kpiAi, stats.ai);

  const top = Object.entries(stats.intents).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = top[0]?.[1] || 1;
  els.topIntents.replaceChildren(...(top.length
    ? top.map(([name, count]) => el('div', { class: 'intent-row' },
      el('span', { text: name }),
      el('span', { class: 'bar' }, el('span', { style: `width:${(count / max) * 100}%` })),
      el('b', { text: String(count) })))
    : [el('span', { class: 'muted small', text: 'No queries yet' })]));
}

// ---------- Agent view ----------

let agentOpen = false;

function transcriptLine(entry) {
  const who = { user: 'Citizen', bot: 'AI bot', agent: 'Officer', system: '' }[entry.who];
  return el('div', { class: `tline ${entry.who}` },
    who ? el('small', { text: `${who} · ${entry.time}` }) : null,
    entry.text);
}

export function openAgent(ctx, transcript) {
  agentOpen = true;
  els.agentEmpty.hidden = true;
  els.agentBody.hidden = false;
  els.agentState.textContent = 'Live · needs reply';
  els.agentState.className = 'agent-state live';

  const rows = [
    ['Customer', 'WhatsApp user · +91 98XXX XX210 (dummy)'],
    ['Language', LANG_LABELS[ctx.language] || ctx.language],
    ['Last intent', ctx.intent],
    ['Reason', ctx.reason],
    ['Application', ctx.ref],
    ['Appointment', ctx.appointment],
    ['Grievance', ctx.ticket],
    ['Consent', ctx.optedOut ? 'Opted out of notifications' : 'Opted in'],
  ].filter(([, v]) => v);
  els.agentCtx.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  els.agentTranscript.replaceChildren(...transcript.map(transcriptLine));
  els.agentTranscript.scrollTop = els.agentTranscript.scrollHeight;
  els.onOpen?.();
}

export function appendTranscript(entry) {
  if (!agentOpen) return;
  els.agentTranscript.append(transcriptLine(entry));
  els.agentTranscript.scrollTop = els.agentTranscript.scrollHeight;
}

export function closeAgent() {
  if (!agentOpen) return;
  agentOpen = false;
  els.agentState.textContent = 'Resolved · back to bot';
  els.agentState.className = 'agent-state done';
}
