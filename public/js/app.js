// Bootstrap: load data, wire the phone input, control bar, prompt chips and panels.

import * as chat from './chat.js';
import * as panels from './panels.js';
import { loadData, getHealth } from './api.js';
import { createFlows } from './flows.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const OFFLINE = params.get('offline') === '1';

function initialMode() {
  if (params.get('mode') === 'ai' || params.get('mode') === 'static') return params.get('mode');
  try { return localStorage.getItem('chatMode') === 'ai' ? 'ai' : 'static'; } catch { return 'static'; }
}
let mode = initialMode();

// Sample prompts per mode. Static mode shows the scripted features; AI mode shows open conversation.
const PROMPT_CHIPS = {
  static: [
    { text: 'How do I register as a new voter?', tag: 'FAQ' },
    { text: 'REF-2026-10452', tag: 'status' },
    { text: 'Which party should I vote for?', tag: 'neutrality' },
    { text: 'When is the next election in my area?', tag: 'no invention' },
    { text: 'मतदाता सूची में अपना नाम कैसे देखें?', tag: 'Hindi' },
    { text: 'வாக்குச்சாவடியில் எந்த அடையாள அட்டை காட்டலாம்?', tag: 'Tamil' },
    { text: 'voter id kaise download kare?', tag: 'Hinglish' },
    { text: 'My Aadhaar is 1234 5678 9012', tag: 'PII' },
    { text: 'I want to talk to an officer', tag: 'handover' },
    { text: 'STOP', tag: 'opt-out' },
  ],
  ai: [
    { text: 'Hi! I just turned 18, how do I become a voter?', tag: 'new voter' },
    { text: 'I moved to Chennai from Delhi. What should I do about my voter ID?', tag: 'shifting' },
    { text: 'My application is REF-2026-10454, what is pending?', tag: 'status' },
    { text: 'I lost my voter ID card, can I still vote?', tag: 'ID at booth' },
    { text: 'Who will win the election?', tag: 'neutrality' },
    { text: 'मेरे दादाजी 87 साल के हैं, क्या वो घर से वोट दे सकते हैं?', tag: 'Hindi' },
    { text: 'naan NRI, enaku vote panna mudiyuma?', tag: 'Tanglish' },
    { text: 'Someone is distributing cash in my area', tag: 'cVIGIL' },
  ],
};

let toastTimer;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

function startClock() {
  const tick = () => {
    $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 15000);
}

function setTab(tab) {
  $('stage').dataset.tab = tab;
  document.querySelectorAll('#panelTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}

function applyLangToUi(lang) {
  $('langSelect').value = lang;
  $('msgInput').placeholder = t(lang, 'placeholder');
  $('presence').textContent = t(lang, 'online');
  document.documentElement.lang = lang;
}

async function main() {
  startClock();
  const data = await loadData();
  $('botName').textContent = data.org.botName;

  panels.initPanels({
    btsList: $('btsList'),
    btsEmpty: $('btsEmpty'),
    presence: $('presence'),
    kpiConv: $('kpiConv'),
    kpiResolved: $('kpiResolved'),
    kpiEsc: $('kpiEsc'),
    kpiAi: $('kpiAi'),
    topIntents: $('topIntents'),
    agentState: $('agentState'),
    agentEmpty: $('agentEmpty'),
    agentBody: $('agentBody'),
    agentCtx: $('agentCtx'),
    agentTranscript: $('agentTranscript'),
    onOpen: () => {
      $('stage').classList.remove('hide-right');
      $('btnToggleRight').setAttribute('aria-pressed', 'true');
      toast('Handover: Agent view opened with full context');
    },
  });

  const flows = createFlows({ data, panels, offline: OFFLINE, onLangChange: applyLangToUi });

  chat.initChat({
    container: $('chat'),
    sheetEls: { root: $('sheet'), backdrop: $('sheetBackdrop'), title: $('sheetTitle'), body: $('sheetBody'), close: $('sheetClose') },
    actionHandler: (id, label) => flows.handleAction(id, label),
  });

  // Phone input
  const input = $('msgInput');
  const bar = $('inputBar');
  input.addEventListener('input', () => bar.classList.toggle('has-text', input.value.trim().length > 0));
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    bar.classList.remove('has-text');
    flows.handleText(text);
    input.focus();
  });
  $('btnEmoji').addEventListener('click', () => {
    input.value += '🙂';
    bar.classList.add('has-text');
    input.focus();
  });
  $('btnAttach').addEventListener('click', () => toast('Attachments are disabled in this demo'));

  // Chatbot type: Static (scripted flows) or AI (every reply from the model)
  const restart = () => { panels.reset(); flows.start($('langSelect').value, mode); };
  const renderChips = () => {
    $('promptChips').replaceChildren(...PROMPT_CHIPS[mode].map((c) => chat.el('button', {
      class: 'chip', type: 'button', title: `Send: ${c.text}`,
      onclick: () => { flows.handleText(c.text); setTab('phone'); },
    }, c.text, chat.el('span', { class: 'chip-tag', text: c.tag }))));
  };
  const setMode = (next, { announce = true } = {}) => {
    mode = next;
    document.querySelectorAll('#modeSwitch button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    document.body.dataset.mode = mode;
    try { localStorage.setItem('chatMode', mode); } catch { /* storage unavailable */ }
    const url = new URL(location.href);
    url.searchParams.set('mode', mode);
    history.replaceState(null, '', url);
    renderChips();
    if (announce) {
      restart();
      toast(mode === 'ai' ? 'AI Chatbot: every reply comes from the AI model' : 'Static Chatbot: guided menus and buttons');
    }
  };
  document.querySelectorAll('#modeSwitch button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode !== mode) setMode(b.dataset.mode);
  }));

  // Control bar
  $('btnReset').addEventListener('click', () => {
    restart();
    toast('Chat, state and counters cleared');
  });
  $('langSelect').addEventListener('change', (e) => {
    flows.setLang(e.target.value);
    toast(`Language set to ${t(e.target.value, 'langName')}`);
  });
  $('btnNotify').addEventListener('click', () => {
    const kind = flows.simulateNotification();
    if (kind === 'suppressed') toast('User opted out: notification suppressed');
    setTab('phone');
  });
  const toggle = (btnId, cls) => {
    const btn = $(btnId);
    btn.addEventListener('click', () => {
      const hidden = $('stage').classList.toggle(cls);
      btn.setAttribute('aria-pressed', String(!hidden));
    });
  };
  toggle('btnToggleBts', 'hide-bts');
  toggle('btnToggleRight', 'hide-right');


  // Agent view
  $('agentReply').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('agentInput').value.trim();
    if (!text) return;
    $('agentInput').value = '';
    flows.agentSay(text);
  });
  $('agentEnd').addEventListener('click', () => flows.endHandover());

  // Tabs (tablet / mobile)
  document.querySelectorAll('#panelTabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  setTab('phone');

  // Mode badge
  const badge = $('modeBadge');
  if (OFFLINE) {
    const aiBtn = document.querySelector('#modeSwitch [data-mode="ai"]');
    aiBtn.disabled = true;
    aiBtn.title = 'AI Chatbot needs the AI service (offline mode is on)';
    badge.textContent = 'OFFLINE MODE · scripted only';
    badge.hidden = false;
  } else {
    getHealth().then((res) => {
      if (!res.ok || !res.data?.aiConfigured) {
        badge.textContent = 'AI not configured · fallback active';
        badge.hidden = false;
      }
    });
  }

  applyLangToUi(data.org.defaultLanguage);
  setMode(OFFLINE ? 'static' : mode, { announce: false });
  flows.start(data.org.defaultLanguage, mode);
}

main().catch((err) => {
  console.error(err);
  document.body.prepend(chat.el('p', { style: 'padding:16px;color:#a12c2c', text: 'Could not load demo data. Is the server running (npm start)?' }));
});
