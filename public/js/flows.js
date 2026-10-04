// Scripted flow engine. Buttons carry stable payload IDs; free text is matched
// against a few deterministic rules and everything else goes to the live AI.

import * as chat from './chat.js';
import * as api from './api.js';
import { t, faqText, detectScript, LANGS } from './i18n.js';

const REF_PATTERN = /\bREF-\d{4}-\d{5}\b/i;
const REF_LOOSE = /\bREF[\s-]*\d/i;
const PII_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b|\b\d{10,}\b|\b(otp|password|passcode|pin)\b.*\d{4,}/i;
const OFFICER_PATTERN = /\b(officer|human|real person|agent|customer care)\b|अधिकारी|इंसान|அதிகாரி/i;
const MENU_PATTERN = /^(menu|main menu|start over|मेन्यू|மெனு)[\s!.]*$/i;
// Greetings are answered by the AI; only offline mode maps them to the menu.
const GREETING_PATTERN = /^(hi+|hello|hey|help|namaste|vanakkam|नमस्ते|வணக்கம்)[\s!.]*$/i;
const REF_LIKE = /^[a-z]{0,4}[\s-]*\d[\d\s-]{2,}$/i;
const LANG_WORDS = { en: /^(english|eng)$/i, hi: /^(hindi|हिन्दी|हिंदी)$/i, ta: /^(tamil|தமிழ்)$/i };
const FAQ_LIST_IDS = ['faq_eligibility', 'faq_documents_required', 'faq_how_to_apply', 'faq_last_date', 'faq_payment_methods', 'faq_office_timings'];
const LOW_CONFIDENCE = 0.5;
const DEMO_NOTIFY_REF = 'REF-2026-10452';

// Keyword map used only in ?offline=1 mode (no AI).
const OFFLINE_KEYWORDS = [
  [/document|papers|proof|दस्तावेज़|ஆவண/i, 'faq_documents_required'],
  [/eligib|who can apply|पात्र|தகுதி/i, 'faq_eligibility'],
  [/how (do|to|can) i apply|apply online|आवेदन कैसे|விண்ணப்பிப்ப/i, 'faq_how_to_apply'],
  [/last date|deadline|closing|अंतिम तिथि|கடைசி தேதி/i, 'faq_last_date'],
  [/fee|pay|upi|शुल्क|கட்டண/i, 'faq_payment_methods'],
  [/timing|hours|open|office time|समय|நேரம்/i, 'faq_office_timings'],
  [/holiday|sunday|saturday|छुट्टी|விடுமுறை/i, 'faq_holidays'],
  [/contact|phone|email|call/i, 'faq_contact'],
  [/track/i, 'faq_track_application'],
  [/mistake|correct|edit|गलती|தவறு/i, 'faq_correct_mistake'],
  [/certificate|प्रमाण पत्र|சான்றிதழ்/i, 'faq_download_certificate'],
  [/scholarship|छात्रवृत्ति|உதவித்தொகை/i, 'faq_scholarships'],
  [/privacy|my data|डेटा/i, 'faq_data_privacy'],
];

export function createFlows({ data, panels, offline, onLangChange }) {
  let state;
  let queue = Promise.resolve();
  let pendingTicks = [];
  let grievanceSeq = 41;

  function freshState(lang = data.org.defaultLanguage) {
    return {
      lang,
      step: null,
      optedOut: false,
      handover: false,
      lastRef: null,
      lastIntent: null,
      lastLang: lang,
      appointment: null,
      reminderSent: false,
      statusReminders: new Set(),
      statusOverrides: {},
      history: [],
      transcript: [],
    };
  }

  const L = (key, vars) => t(state.lang, key, vars);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const typingDelay = () => 600 + Math.random() * 800;

  // ---------- Output helpers ----------

  function record(who, text) {
    const entry = { who, text, time: chat.timeNow() };
    state.transcript.push(entry);
    if (who === 'user') state.history.push({ role: 'user', content: text });
    if (who === 'bot' || who === 'agent') state.history.push({ role: 'assistant', content: text });
    state.history = state.history.slice(-40);
    panels.appendTranscript(entry);
  }

  function markRead() {
    pendingTicks.forEach((set) => set('read'));
    pendingTicks = [];
  }

  // Queue a bot reply behind a typing indicator so replies never overlap.
  function botTurn(render, { delay = typingDelay() } = {}) {
    queue = queue.then(async () => {
      markRead();
      chat.showTyping();
      panels.setPresence(L('typing'));
      await sleep(delay);
      chat.hideTyping();
      panels.setPresence(L('online'));
      await render();
    }).catch((err) => console.error(err));
    return queue;
  }

  function say(text, extra = {}, transcriptText = text) {
    return botTurn(() => {
      chat.addBotMessage({ text, ...extra });
      record('bot', transcriptText);
    }, extra.delay ? { delay: extra.delay } : undefined);
  }

  function note(text, variant) {
    queue = queue.then(() => {
      chat.addSystemNote(text, variant);
      record('system', text);
    });
    return queue;
  }

  function logScripted(query, intent, sources, extra = {}) {
    panels.log({
      route: 'scripted', query, language: state.lang, intent,
      confidence: 1, sources, latency: null, ...extra,
    });
  }

  const officerBtn = () => ({ id: 'officer', label: L('talkOfficer') });
  const menuBtn = () => ({ id: 'menu', label: L('mainMenu') });

  // ---------- Greeting, consent, menu ----------

  function start(lang) {
    state = freshState(lang || data.org.defaultLanguage);
    queue = Promise.resolve();
    pendingTicks = [];
    chat.clearChat();
    chat.addDateChip('Today');
    chat.addSystemNote(L('bizNote'), 'biz');
    state.step = 'lang';
    say(`${L('consent', { bot: data.org.botName, org: data.org.orgName })}\n\n${L('chooseLang')}`, {
      buttons: LANGS.map((code) => ({ id: `lang:${code}`, label: t(code, 'langName') })),
    });
    logScripted('(conversation start)', 'greeting', ['org.json'], { label: 'Consent + language' });
  }

  function mainMenuList() {
    const rows = ['faq', 'status', 'appointment', 'documents', 'grievance', 'officer'].map((key) => {
      const [title, description] = L(`menu.${key}`);
      return { id: `menu:${key}`, title, description };
    });
    return { button: L('viewOptions'), title: L('menuTitle'), sections: [{ title: L('menuSection'), rows }] };
  }

  function showMenu() {
    state.step = null;
    say(L('howHelp'), { list: mainMenuList() });
  }

  function setLang(lang, { announce = true } = {}) {
    state.lang = lang;
    onLangChange?.(lang);
    if (announce) showMenu();
  }

  // ---------- FAQ ----------

  function faqList() {
    const rows = FAQ_LIST_IDS.map((id) => data.faqs.find((f) => f.id === id)).filter(Boolean).map((faq) => {
      const { question } = faqText(state.lang, faq);
      return { id: `faq:${faq.id}`, title: question, description: faq.category };
    });
    return { button: L('viewOptions'), title: L('faqTitle'), sections: [{ title: L('faqSection'), rows }] };
  }

  function showFaqList() {
    say(L('faqIntro'), { list: faqList() });
  }

  function answerFaq(id, query, route = 'scripted') {
    const faq = data.faqs.find((f) => f.id === id);
    if (!faq) return;
    const { answer } = faqText(state.lang, faq);
    say(answer, { source: { title: faq.source, description: `${L('source')}: ${data.org.orgName}`, url: faq.url } });
    if (route === 'offline') {
      panels.log({ route: 'offline', query, language: state.lang, intent: 'faq', confidence: 0.7, sources: [id], latency: null, label: 'Keyword match (offline)' });
    } else {
      logScripted(query, 'faq', [id]);
    }
    panels.recordQuery({ intent: 'faq', resolved: true });
  }

  // ---------- Application status ----------

  function askRef() {
    state.step = 'ref';
    say(L('askRef'));
  }

  async function lookupStatus(ref, query) {
    state.step = null;
    ref = ref.toUpperCase();
    const res = await api.getApplication(ref);
    let app = res.ok ? res.data : null;
    if (!res.ok && res.status !== 404) app = data.applications.find((a) => a.ref === ref) || null;

    if (!app) {
      say(L('refNotFound', { ref }), { buttons: [officerBtn(), menuBtn()] });
      logScripted(query, 'status', ['applications.json'], { tags: ['not found'] });
      panels.recordQuery({ intent: 'status', resolved: false });
      return;
    }
    state.lastRef = ref;
    showStatusCard(app, true);
    logScripted(query, 'status', [`applications.json#${ref}`], { label: res.ok ? 'GET /api/application' : 'Local data' });
    panels.recordQuery({ intent: 'status', resolved: true });
  }

  function showStatusCard(app, withFollowUp) {
    const statusKey = state.statusOverrides[app.ref] || app.statusKey;
    const view = {
      ...app,
      statusKey,
      statusLabel: L(`statusNames.${statusKey}`),
      updated: state.statusOverrides[app.ref] ? 'Today' : app.updated,
      nextStep: state.statusOverrides[app.ref] ? 'Download your certificate' : app.nextStep,
    };
    const text = withFollowUp && statusKey !== 'approved' ? L('statusFollow') : '';
    const buttons = withFollowUp
      ? [{ id: `remind:${app.ref}`, label: L('remindMe') }, officerBtn()]
      : [menuBtn()];
    say(text, { cardNode: chat.statusCard(view, L('statusLabels')), buttons, wide: true },
      `[Status card] ${app.ref} | ${view.statusLabel} | Updated ${view.updated}. ${text}`);
  }

  // ---------- Appointment ----------

  function dateButtons(page) {
    const dates = data.slots.dates;
    const shown = page === 0 ? dates.slice(0, 2) : dates.slice(2, 4);
    const buttons = shown.map((d) => ({ id: `date:${d.id}`, label: d.label }));
    buttons.push(page === 0 ? { id: 'date:more', label: L('moreDates') } : { id: `date:${dates[4].id}`, label: dates[4].label });
    return buttons;
  }

  function askDate(page = 0) {
    state.step = 'appt_date';
    say(L('apptDate'), { buttons: dateButtons(page) });
  }

  function askTime(dateId, query) {
    const date = data.slots.dates.find((d) => d.id === dateId);
    if (!date) return;
    state.step = 'appt_time';
    state.appointment = { date: date.label };
    say(L('apptTime', { date: date.label }), {
      buttons: data.slots.times.map((s) => ({ id: `time:${s.id}`, label: s.label })),
    });
    logScripted(query, 'appointment', ['slots.json']);
  }

  function confirmAppointment(timeId, query) {
    const time = data.slots.times.find((s) => s.id === timeId);
    if (!time || !state.appointment) return;
    state.appointment.time = time.label;
    state.reminderSent = false;
    state.step = null;
    const { date } = state.appointment;
    say(L('apptConfirmed', { date, time: time.label }));
    botTurn(() => {
      chat.addBotMessage({ cardNode: chat.imageCard('/assets/campus-map.svg', 'Campus map'), text: L('apptMap') });
      record('bot', `[Image] ${L('apptMap')}`);
    }, { delay: 700 });
    askFeedback();
    logScripted(query, 'appointment', ['slots.json'], { label: 'Booking confirmed' });
    panels.recordQuery({ intent: 'appointment', resolved: true });
  }

  // ---------- Documents ----------

  function documentsList() {
    const rows = data.documents.map((d) => ({ id: `doc:${d.id}`, title: d.title, description: d.description }));
    return { button: L('viewDocs'), title: L('docsTitle'), sections: [{ title: '', rows }] };
  }

  function showDocuments() {
    say(L('docsIntro'), { list: documentsList() });
  }

  function sendDocument(id, query) {
    const doc = data.documents.find((d) => d.id === id);
    if (!doc) return;
    say(L('docSent'), { cardNode: chat.documentCard(doc), wide: true }, `[Document] ${doc.title}.pdf`);
    askFeedback();
    logScripted(query, 'document', [`documents.json#${id}`]);
    panels.recordQuery({ intent: 'document', resolved: true });
  }

  // ---------- Grievance ----------

  function askGrievance() {
    state.step = 'grievance';
    say(L('grievanceAsk'));
  }

  function registerGrievance(text) {
    state.step = null;
    grievanceSeq += 1;
    const ticket = `GRV-2026-${String(grievanceSeq).padStart(4, '0')}`;
    state.lastTicket = ticket;
    say(L('grievanceDone', { ticket }));
    askFeedback();
    logScripted(text, 'grievance', ['grievance-policy'], { label: `Ticket ${ticket}` });
    panels.recordQuery({ intent: 'grievance', resolved: true });
  }

  // ---------- Feedback ----------

  function askFeedback() {
    say(L('helpful'), { buttons: [{ id: 'fb:yes', label: L('yes') }, { id: 'fb:no', label: L('no') }], delay: 1400 });
  }

  // ---------- Human handover ----------

  function startHandover(query, reason = 'User request', { silent = false } = {}) {
    if (state.handover) return;
    state.handover = true;
    state.step = null;
    if (!silent) say(L('handover'));
    note(L('handoverNote'), 'handover');
    queue = queue.then(() => {
      panels.openAgent({
        language: state.lastLang,
        intent: state.lastIntent || 'handover',
        reason,
        ref: state.lastRef,
        appointment: state.appointment?.time ? `${state.appointment.date}, ${state.appointment.time}` : null,
        ticket: state.lastTicket,
        optedOut: state.optedOut,
      }, state.transcript);
    });
    queue = queue.then(() => sleep(1200)).then(() => {
      chat.addSystemNote(L('officerJoined'), 'handover');
      record('system', L('officerJoined'));
    });
    if (!silent) logScripted(query, 'handover', [], { label: reason, tags: ['escalated'] });
    panels.recordQuery({ intent: 'handover', resolved: false, escalated: true, ai: silent });
  }

  function agentSay(text) {
    if (!state.handover) return;
    chat.addBotMessage({ text, sender: L('officerName') });
    record('agent', text);
  }

  function endHandover() {
    if (!state.handover) return;
    state.handover = false;
    panels.closeAgent();
    note(L('handoverEndNote'), 'handover');
    say(L('handoverEnd'));
    askFeedback();
  }

  // ---------- Proactive notifications ----------

  function simulateNotification() {
    if (state.optedOut) {
      chat.addSystemNote(L('suppressed'));
      panels.log({ route: 'scripted', query: '(proactive notification)', language: state.lang, intent: 'notification', confidence: 1, sources: [], latency: null, tags: ['suppressed', 'opted out'] });
      return 'suppressed';
    }
    if (state.appointment?.time && !state.reminderSent) {
      state.reminderSent = true;
      const { date, time } = state.appointment;
      botTurn(() => {
        chat.addBotMessage({
          header: chat.templateHeader(L('templateLabel'), L('reminderTitle')),
          text: L('apptReminder', { date, time }),
          footer: L('notifyFooter'),
          variant: 'template',
          wide: true,
          buttons: [{ id: 'appt:keep', label: L('keepIt') }, { id: 'appt:reschedule', label: L('reschedule') }],
        });
        record('bot', L('apptReminder', { date, time }));
      }, { delay: 300 });
      panels.log({ route: 'scripted', query: '(proactive: appointment reminder)', language: state.lang, intent: 'notification', confidence: 1, sources: ['slots.json'], latency: null, label: 'Template message' });
      return 'reminder';
    }
    const ref = state.lastRef && data.applications.some((a) => a.ref === state.lastRef && a.statusKey !== 'approved')
      ? state.lastRef : DEMO_NOTIFY_REF;
    state.statusOverrides[ref] = 'approved';
    botTurn(() => {
      chat.addBotMessage({
        header: chat.templateHeader(L('templateLabel'), L('notifyTitle')),
        text: L('notifyBody', { ref }),
        footer: L('notifyFooter'),
        variant: 'template',
        wide: true,
        buttons: [{ id: `view:${ref}`, label: L('viewDetails') }],
      });
      record('bot', L('notifyBody', { ref }));
    }, { delay: 300 });
    panels.log({ route: 'scripted', query: '(proactive: status update)', language: state.lang, intent: 'notification', confidence: 1, sources: [`applications.json#${ref}`], latency: null, label: 'Template message' });
    return 'status';
  }

  // ---------- Live AI ----------

  function aiContext() {
    const app = state.lastRef && data.applications.find((a) => a.ref === state.lastRef);
    const statusKey = app && (state.statusOverrides[app.ref] || app.statusKey);
    return {
      lastRef: state.lastRef || undefined,
      lastStatus: statusKey ? t('en', `statusNames.${statusKey}`) : undefined,
      nextStep: app && !state.statusOverrides[app.ref] ? app.nextStep : undefined,
      appointment: state.appointment?.time ? `${state.appointment.date}, ${state.appointment.time}` : undefined,
      ticket: state.lastTicket,
      optedOut: state.optedOut,
    };
  }

  async function askAi(text) {
    const guessLang = detectScript(text) || state.lang;
    if (offline) return answerOffline(text, guessLang);

    const entry = state.history[state.history.length - 1];
    queue = queue.then(async () => {
      markRead();
      chat.showTyping();
      panels.setPresence(L('typing'));
      // History is read when the turn starts, so it includes replies queued before this one.
      const idx = state.history.indexOf(entry);
      const history = idx === -1 ? state.history.slice() : state.history.slice(0, idx);
      const started = performance.now();
      const res = await api.postChat(text, history, state.lang, aiContext());
      const elapsed = performance.now() - started;
      if (elapsed < 700) await sleep(700 - elapsed);
      chat.hideTyping();
      panels.setPresence(L('online'));
      renderAiReply(text, res, guessLang);
    }).catch((err) => console.error(err));
    return queue;
  }

  // The AI can ask the app to open a built-in step; the UI is attached to its reply.
  function actionUi(action) {
    switch (action) {
      case 'menu': return { list: mainMenuList() };
      case 'faq_list': return { list: faqList() };
      case 'documents': return { list: documentsList() };
      case 'appointment':
        state.step = 'appt_date';
        return { buttons: dateButtons(0) };
      case 'status': state.step = 'ref'; return {};
      case 'grievance': state.step = 'grievance'; return {};
      default: return {};
    }
  }

  function renderAiReply(query, res, guessLang) {
    if (!res.ok || !res.data?.reply || res.data.fallback) {
      const reason = res.error || res.data?.reason || `HTTP ${res.status}`;
      const lang = LANGS.includes(guessLang) ? guessLang : state.lang;
      chat.addBotMessage({ text: t(lang, 'fallback'), buttons: [{ id: 'officer', label: t(lang, 'talkOfficer') }] });
      record('bot', t(lang, 'fallback'));
      panels.log({ route: 'fallback', query, language: lang, intent: 'handover', confidence: 0, sources: [], latency: res.latency, tags: ['fallback used'], label: reason });
      panels.recordQuery({ intent: 'fallback', resolved: false });
      return;
    }

    const r = res.data;
    // Follow the user if they switch script mid-chat (menus and buttons switch too).
    if (LANGS.includes(r.language) && r.language !== state.lang && detectScript(query) === r.language) {
      setLang(r.language, { announce: false });
    }
    const lang = LANGS.includes(r.language) ? r.language : state.lang;
    state.lastIntent = r.intent;
    state.lastLang = r.language;
    const low = r.confidence < LOW_CONFIDENCE;
    const action = r.action || 'none';
    const offerOfficer = action !== 'handover' && (r.escalate || low || r.intent === 'out_of_scope');

    const faq = r.sources.map((id) => data.faqs.find((f) => f.id === id)).find(Boolean);
    const ui = action === 'handover' ? {} : actionUi(action);
    // Suggestions are hidden when the next message is free text the app collects (grievance, reference no.).
    const collectsText = action === 'grievance' || action === 'status';
    const suggestions = ui.list || collectsText ? [] : r.suggested_replies
      .filter((s) => !OFFICER_PATTERN.test(s))
      .map((s) => ({ id: `ask:${s}`, label: s }));
    let buttons = ui.buttons || suggestions;
    if (offerOfficer && !ui.buttons) {
      buttons = [...buttons.slice(0, 2), { id: 'officer', label: t(lang, 'talkOfficer') }];
    }

    chat.addBotMessage({
      text: r.reply,
      ai: '✦ AI',
      source: faq && !offerOfficer && action === 'none' ? { title: faq.source, description: `${t(lang, 'source')}: ${data.org.orgName}`, url: faq.url } : null,
      buttons: buttons.slice(0, 3),
      list: ui.list,
    });
    record('bot', r.reply);

    const tags = [];
    if (action !== 'none') tags.push(`action: ${action}`);
    if (low) tags.push('low confidence');
    if (r.escalate) tags.push('escalate');
    if (r.intent === 'out_of_scope') tags.push('guardrail');
    panels.log({
      route: 'ai', query, language: r.language, intent: r.intent, confidence: r.confidence,
      sources: r.sources, latency: r.latency_ms ?? res.latency, tags,
    });

    if (action === 'handover') {
      startHandover(query, 'AI detected request for a human', { silent: true });
      return;
    }
    panels.recordQuery({ intent: r.intent, resolved: !offerOfficer, ai: true });
  }

  function answerOffline(text, lang) {
    const match = OFFLINE_KEYWORDS.find(([re]) => re.test(text));
    if (match) return answerFaq(match[1], text, 'offline');
    say(t(lang, 'offlineNoMatch'), { buttons: [{ id: 'officer', label: t(lang, 'talkOfficer') }] });
    panels.log({ route: 'offline', query: text, language: lang, intent: 'out_of_scope', confidence: 0.2, sources: [], latency: null, tags: ['no match'], label: 'Offline mode' });
    panels.recordQuery({ intent: 'out_of_scope', resolved: false });
  }

  // ---------- Input handling ----------

  function userSays(text) {
    chat.closeSheet();
    const setTicks = chat.addUserMessage(text);
    pendingTicks.push(setTicks);
    record('user', text);
  }

  // Button / list-row taps.
  function handleAction(id, label) {
    userSays(label);
    if (state.handover) return;
    const [kind, arg] = id.split(/:(.*)/s);

    switch (kind) {
      case 'lang': {
        state.step = null;
        logScripted(label, 'language', ['i18n.js'], { language: arg });
        return setLang(arg);
      }
      case 'menu':
        if (!arg) return showMenu();
        return openMenuItem(arg, label);
      case 'faq': return answerFaq(arg, label);
      case 'remind':
        state.statusReminders.add(arg);
        return say(L('reminderSet', { ref: arg }));
      case 'view': {
        const app = data.applications.find((a) => a.ref === arg);
        return app && showStatusCard(app, false);
      }
      case 'date':
        if (arg === 'more') return askDate(1);
        return askTime(arg, label);
      case 'time': return confirmAppointment(arg, label);
      case 'appt':
        if (arg === 'reschedule') return askDate(0);
        return say(L('keepItAck'));
      case 'doc': return sendDocument(arg, label);
      case 'fb':
        panels.log({ route: 'scripted', query: label, language: state.lang, intent: 'feedback', confidence: 1, sources: [], latency: null, tags: [arg === 'yes' ? 'positive' : 'negative'] });
        if (arg === 'yes') return say(L('thanksYes'));
        return say(L('thanksNo'), { buttons: [officerBtn(), menuBtn()] });
      case 'officer': return startHandover(label);
      case 'ask': return handleText(arg, { echo: false });
      default: return undefined;
    }
  }

  function openMenuItem(key, label) {
    switch (key) {
      case 'faq': logScripted(label, 'faq', ['faqs.json']); return showFaqList();
      case 'status': logScripted(label, 'status', []); return askRef();
      case 'appointment': logScripted(label, 'appointment', ['slots.json']); return askDate(0);
      case 'documents': logScripted(label, 'document', ['documents.json']); return showDocuments();
      case 'grievance': logScripted(label, 'grievance', []); return askGrievance();
      case 'officer': return startHandover(label);
      default: return undefined;
    }
  }

  // Free-typed text.
  function handleText(raw, { echo = true } = {}) {
    const text = raw.trim();
    if (!text) return;
    if (echo) userSays(text);
    const script = detectScript(text);
    if (script) state.lastLang = script;

    if (state.handover) return;

    if (/^stop$/i.test(text) || text === 'रोकें' || text === 'நிறுத்து') {
      state.optedOut = true;
      logScripted(text, 'opt_out', [], { tags: ['opted out'] });
      return say(L('optedOut'));
    }
    if (/^start$/i.test(text)) {
      state.optedOut = false;
      logScripted(text, 'opt_in', []);
      return say(L('optedIn'));
    }

    if (state.step === 'lang') {
      const lang = Object.keys(LANG_WORDS).find((code) => LANG_WORDS[code].test(text));
      if (lang) {
        state.step = null;
        logScripted(text, 'language', ['i18n.js'], { language: lang });
        return setLang(lang);
      }
      state.step = null;
      if (script) state.lang = script;
    }

    if (MENU_PATTERN.test(text) || (offline && GREETING_PATTERN.test(text))) {
      logScripted(text, 'menu', []);
      return showMenu();
    }
    if (/^reschedule$/i.test(text)) return askDate(0);

    const ref = text.match(REF_PATTERN);
    if (ref) return lookupStatus(ref[0], text);

    if (state.step === 'grievance') return registerGrievance(text);

    if (PII_PATTERN.test(text)) {
      logScripted(text, 'pii_warning', [], { tags: ['pii guard'] });
      return say(L('pii'));
    }

    if (state.step === 'ref') {
      if (REF_LOOSE.test(text) || REF_LIKE.test(text)) {
        logScripted(text, 'status', [], { tags: ['invalid format'] });
        return say(L('refInvalid'), { buttons: [officerBtn(), menuBtn()] });
      }
      state.step = null;
    }

    // Short explicit requests hand over instantly; longer messages go to the AI, which can also hand over.
    if (OFFICER_PATTERN.test(text) && text.length < 40) return startHandover(text);

    return askAi(text);
  }

  return {
    start,
    handleText,
    handleAction,
    simulateNotification,
    agentSay,
    endHandover,
    setLang: (lang) => setLang(lang),
    get state() { return state; },
  };
}
