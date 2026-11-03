// Scripted flow engine. Buttons carry stable payload IDs; free text is matched
// against a few deterministic rules and everything else goes to the live AI.

import * as chat from './chat.js?v=sec4';
import * as api from './api.js?v=sec4';
import { t, faqText, pick, detectScript, LANGS } from './i18n.js?v=sec4';

const CMP_PATTERN = /\bCMP-\d{4}-\d{5}\b/i;
const CMP_LOOSE = /\bCMP[\s-]*\d/i;
const PII_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b|\b\d{10,}\b|\b(otp|password|passcode|pin)\b.*\d{4,}/i;
const OFFICER_PATTERN = /\b(officer|human|real person|agent|customer care|adhikari)\b|अधिकारी|इंसान|அலுவலர்|அதிகாரி/i;
const MENU_PATTERN = /^(menu|main menu|start over|मेन्यू|मेनू|मुख्य मेन्यू|மெனு)[\s!.]*$/i;
// Greetings are answered by the AI; only offline mode maps them to the menu.
const GREETING_PATTERN = /^(hi+|hello|hey|help|namaste|namaskar|vanakkam|नमस्ते|नमस्कार|प्रणाम|வணக்கம்)[\s!.]*$/i;
const REF_LIKE = /^[a-z]{0,4}[\s-]*\d[\d\s-]{2,}$/i;
const LANG_WORDS = { en: /^(english|eng|अंग्रेज़ी|अंग्रेजी)$/i, hi: /^(hindi|हिन्दी|हिंदी)$/i };
const PAGE_SIZE = 9; // WhatsApp lists hold 10 rows: 9 questions + "More questions"
const LOW_CONFIDENCE = 0.5;
const DEMO_NOTIFY_REF = 'CMP-2026-00412';

// Keyword map used only in ?offline=1 mode (no AI).
const OFFLINE_KEYWORDS = [
  [/e-?voting|secbhr|ई-?वोटिंग|ऐप/i, 'municipal_23'],
  [/nomination fee|age|उम्र|आयु|शुल्क|eligib|पात्र/i, 'panchayat_04'],
  [/nomination|नामांकन|affidavit|शपथ/i, 'municipal_06'],
  [/voter list|e-?roll|my name|मतदाता सूची|नाम/i, 'panchayat_11'],
  [/helpline|हेल्पलाइन|contact|call/i, 'municipal_17'],
  [/complain|शिकायत/i, 'municipal_21'],
  [/code of conduct|mcc|आचार संहिता/i, 'municipal_11'],
  [/count|मतगणना/i, 'panchayat_07'],
  [/reservation|आरक्षण/i, 'panchayat_02'],
  [/symbol|प्रतीक/i, 'municipal_08'],
];

// mode: 'static' = scripted flows + AI for free text; 'ai' = every reply comes from the AI.
export function createFlows({ data, panels, offline, onLangChange }) {
  let state;
  let queue = Promise.resolve();
  let pendingTicks = [];
  let complaintSeq = 431;

  const faqById = new Map(data.faqs.map((f) => [f.id, f]));
  const docByKey = new Map(data.documents.map((d) => [d.doc, d]));

  function freshState(lang = data.org.defaultLanguage, mode = 'static') {
    return {
      mode,
      lang,
      step: null,
      optedOut: false,
      handover: false,
      handoverPending: [], // messages typed while an officer had the chat and not answered by them
      audience: null,
      lastComplaint: null,
      lastTicket: null,
      lastIntent: null,
      lastLang: lang,
      complaints: {},
      statusReminders: new Set(),
      statusOverrides: {},
      history: [],
      transcript: [],
    };
  }

  const L = (key, vars) => t(state.lang, key, vars);
  const orgName = () => ({ hi: data.org.orgNameHi, ta: data.org.orgNameTa }[state.lang] || data.org.orgName);
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

  function start(lang, mode = 'static') {
    state = freshState(lang || data.org.defaultLanguage, mode);
    queue = Promise.resolve();
    pendingTicks = [];
    chat.clearChat();
    chat.addDateChip(L('today'));
    chat.addSystemNote(L('bizNote'), 'biz');
    if (mode === 'ai') {
      // AI mode: no menus or language buttons; the user drives the conversation.
      say(L('aiWelcome', { org: orgName() }), { delay: 500 });
      panels.log({ route: 'ai', query: '(AI chatbot mode)', language: state.lang, intent: 'greeting', confidence: null, sources: [], latency: null, label: 'Every reply below comes from the AI model' });
      return;
    }
    state.step = 'lang';
    say(`${L('consent', { org: orgName() })}\n\n${L('chooseLang')}`, {
      buttons: LANGS.map((code) => ({ id: `lang:${code}`, label: t(code, 'langName') })),
    });
    logScripted('(conversation start)', 'greeting', ['org.json'], { label: 'Consent + language' });
  }

  function mainMenuList() {
    const rows = data.menu.items.map((item) => ({
      id: `menu:${item.key}`, title: pick(state.lang, item, 'title'), description: pick(state.lang, item, 'desc'),
    }));
    return { button: L('viewOptions'), title: L('menuTitle'), sections: [{ title: L('menuSection'), rows }] };
  }

  function showMenu() {
    state.step = null;
    state.audience = null;
    say(L('howHelp'), { list: mainMenuList() });
  }

  function setLang(lang, { announce = true } = {}) {
    state.lang = lang;
    onLangChange?.(lang);
    if (announce && state.mode !== 'ai') showMenu();
  }

  // ---------- Topic question lists (FAQs) ----------

  function topicList(item, page) {
    const ids = item.faqs.filter((id) => faqById.has(id));
    const shown = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const rows = shown.map((id) => ({ id: `faq:${id}`, title: faqText(state.lang, faqById.get(id)).question }));
    if (ids.length > (page + 1) * PAGE_SIZE) {
      rows.push({ id: `topic:${item.key}:${page + 1}`, title: L('moreQuestions'), description: L('moreQuestionsDesc') });
    }
    const title = pick(state.lang, item, 'title');
    return { button: L('viewQuestions'), title, sections: [{ title: '', rows }] };
  }

  function showTopic(key, page = 0) {
    const item = data.menu.items.find((i) => i.key === key);
    if (!item?.faqs) return;
    state.audience = item.audience || null;
    const topic = pick(state.lang, item, 'title');
    const intro = page > 0 ? L('moreQuestionsDesc') : L(item.audience === 'officials' ? 'officialsIntro' : 'topicIntro', { topic });
    say(intro, { list: topicList(item, page) });
  }

  function faqSource(faq) {
    return { title: L('sourceFaq'), description: `${pick(state.lang, faq, 'category')} · ${faq.source}` };
  }

  function answerFaq(id, query, route = 'scripted') {
    const faq = faqById.get(id);
    if (!faq) return;
    const { answer, translated } = faqText(state.lang, faq);
    // No official text in this language yet (Tamil before translation): the AI gives the official answer in it.
    if (!translated && !offline) return askAi(faq.q_en, { replyLanguage: state.lang });
    say(answer, { source: faqSource(faq), buttons: [menuBtn(), officerBtn()] });
    if (route === 'offline') {
      panels.log({ route: 'offline', query, language: state.lang, intent: 'faq', confidence: 0.7, sources: [id], latency: null, label: 'Keyword match (offline)' });
    } else {
      logScripted(query, 'faq', [id]);
    }
    panels.recordQuery({ intent: 'faq', resolved: true });
  }

  // ---------- Complaints ----------

  function showComplaintMenu() {
    state.step = null;
    say(L('complaintIntro'), {
      buttons: [
        { id: 'cmp:new', label: L('complaintNew') },
        { id: 'cmp:status', label: L('complaintStatus') },
        { id: 'faq:municipal_21', label: L('complaintHow') },
      ],
    });
  }

  function askComplaint() {
    state.step = 'complaint';
    say(L('complaintAsk'));
  }

  function registerComplaint(text) {
    state.step = null;
    complaintSeq += 1;
    const ticket = `CMP-2026-${String(complaintSeq).padStart(5, '0')}`;
    state.lastTicket = ticket;
    state.lastComplaint = ticket;
    state.complaints[ticket] = {
      ref: ticket, complainant: { hi: 'आप (डेमो)', ta: 'நீங்கள் (டெமோ)' }[state.lang] || 'You (demo)', category: text.slice(0, 60),
      statusKey: 'registered', updated: L('today'),
      office: { hi: 'जिला निर्वाचन कार्यालय (नमूना)', ta: 'மாவட்ட தேர்தல் அலுவலகம் (மாதிரி)' }[state.lang] || 'District Election Office (sample)',
    };
    say(L('complaintDone', { ticket }));
    askFeedback();
    logScripted(text, 'complaint', ['complaint-flow'], { label: `Ticket ${ticket}` });
    panels.recordQuery({ intent: 'complaint', resolved: true });
  }

  function askComplaintRef() {
    state.step = 'cmp_ref';
    say(L('askComplaintRef'));
  }

  async function lookupComplaint(ref, query) {
    state.step = null;
    ref = ref.toUpperCase();
    let record = state.complaints[ref];
    let label = 'This chat';
    if (!record) {
      const res = await api.getComplaint(ref);
      record = res.ok ? res.data : null;
      label = res.ok ? 'GET /api/complaint' : 'Local data';
      if (!res.ok && res.status !== 404) record = data.complaints.find((c) => c.ref === ref) || null;
    }
    if (!record) {
      say(L('complaintNotFound', { ref }), { buttons: [officerBtn(), menuBtn()] });
      logScripted(query, 'complaint_status', ['complaints.json'], { tags: ['not found'] });
      panels.recordQuery({ intent: 'complaint', resolved: false });
      return;
    }
    state.lastComplaint = ref;
    showComplaintCard(record, true);
    logScripted(query, 'complaint_status', [`complaints.json#${ref}`], { label });
    panels.recordQuery({ intent: 'complaint', resolved: true });
  }

  function showComplaintCard(c, withFollowUp) {
    const statusKey = state.statusOverrides[c.ref] || c.statusKey;
    const labels = L('complaintLabels');
    const view = {
      ref: c.ref,
      statusKey,
      statusLabel: L(`statusNames.${statusKey}`),
      rows: [
        [labels.applicant, c.complainant],
        [labels.category, pick(state.lang, c, 'category')],
        [labels.updated, state.statusOverrides[c.ref] ? L('today') : c.updated],
        [labels.next, pick(state.lang, c, 'office')],
      ],
    };
    const text = withFollowUp && statusKey !== 'approved' ? L('complaintFollow') : '';
    const buttons = withFollowUp && statusKey !== 'approved'
      ? [{ id: `remind:${c.ref}`, label: L('remindMe') }, officerBtn()]
      : [menuBtn()];
    say(text, { cardNode: chat.statusCard(view), buttons, wide: true },
      `[Complaint card] ${c.ref} | ${view.statusLabel}. ${text}`);
  }

  // ---------- Documents (Acts) ----------

  function documentsList() {
    const rows = data.documents.map((d) => ({ id: `doc:${d.id}`, title: pick(state.lang, d, 'title'), description: `${d.description} · ${d.pages} pages` }));
    return { button: L('viewDocs'), title: L('docsTitle'), sections: [{ title: '', rows }] };
  }

  function showDocuments() {
    say(L('docsIntro'), { list: documentsList() });
  }

  function sendDocument(id, query) {
    const doc = data.documents.find((d) => d.id === id);
    if (!doc) return;
    const title = pick(state.lang, doc, 'title');
    say(L('docSent'), { cardNode: chat.documentCard({ ...doc, title }), wide: true }, `[Document] ${title}.pdf`);
    askFeedback();
    logScripted(query, 'document', [`documents.json#${id}`]);
    panels.recordQuery({ intent: 'document', resolved: true });
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
        complaint: state.lastComplaint,
        audience: state.audience,
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
    state.handoverPending = [];
    chat.addBotMessage({ text, sender: L('officerName') });
    record('agent', text);
  }

  function endHandover() {
    if (!state.handover) return;
    state.handover = false;
    panels.closeAgent();
    note(L('handoverEndNote'), 'handover');
    say(L('handoverEnd'));
    // A question the officer left unanswered goes to the bot now, instead of being lost.
    const pending = state.handoverPending.splice(0);
    if (pending.length) return void askAi(pending.join('\n'));
    askFeedback();
  }

  // ---------- Proactive notification (complaint status update) ----------

  function simulateNotification() {
    if (state.optedOut) {
      chat.addSystemNote(L('suppressed'));
      panels.log({ route: 'scripted', query: '(proactive notification)', language: state.lang, intent: 'notification', confidence: 1, sources: [], latency: null, tags: ['suppressed', 'opted out'] });
      return 'suppressed';
    }
    const ref = state.lastComplaint || DEMO_NOTIFY_REF;
    if (!state.complaints[ref] && !data.complaints.some((c) => c.ref === ref)) return 'none';
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
    panels.log({ route: 'scripted', query: '(proactive: complaint update)', language: state.lang, intent: 'notification', confidence: 1, sources: [`complaints.json#${ref}`], latency: null, label: 'Template message' });
    return 'status';
  }

  // ---------- Live AI ----------

  function aiContext(extra = {}) {
    return {
      ...extra,
      ticket: state.lastTicket || undefined,
      audience: state.audience || undefined,
      optedOut: state.optedOut,
    };
  }

  // replyLanguage: answer in this language whatever the message's language (FAQ taps in Tamil).
  async function askAi(text, { replyLanguage } = {}) {
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
      const res = await api.postChat(text, history, state.lang, aiContext({ replyLanguage }), state.mode);
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
      case 'menu':
      case 'faq_list': return { list: mainMenuList() };
      case 'grievance': state.step = 'complaint'; return {};
      case 'documents': return { list: documentsList() };
      default: return {};
    }
  }

  // Citation card under an AI reply: the first source, with a link to the Act PDF at that page.
  function citationSource(citations, lang) {
    if (!citations?.length) return null;
    const c = citations[0];
    const more = citations.length > 1 ? ` · +${citations.length - 1} ${{ hi: 'अन्य स्रोत', ta: 'பிற ஆதாரங்கள்' }[lang] || 'more'}` : '';
    const caution = c.reliability && c.reliability !== 'high' ? ` · ⚠ ${t(lang, 'verifyNote')}` : '';
    if (c.type === 'faq') {
      const faq = faqById.get(c.faq_id);
      const title = faq ? faqText(lang, faq).question : c.title_en; // Tamil when translated, else English
      return { title: t(lang, 'sourceFaq'), description: `${lang === 'hi' ? c.title : title}${more}` };
    }
    if (c.type === 'case_study') {
      return { title: t(lang, 'caseStudy'), description: `${c.title}${more}` };
    }
    const doc = docByKey.get(c.doc);
    return {
      title: `${c.act} · ${t(lang, 'sourceAct')} ${c.section}`,
      description: `${c.title}${more}${caution}`,
      url: doc ? `assets/${doc.file}${c.page ? `#page=${c.page}` : ''}` : undefined,
    };
  }

  // What our search model found, for the "Behind the scenes" panel.
  function searchNote(r) {
    const s = r.search || {};
    if (r.route === 'lookup') return 'Direct section lookup';
    if (r.route === 'faq' && s.top_faq) return `Our model: FAQ match ${s.top_faq.id} (score ${s.top_faq.score})`;
    if (s.top_section) return `Our model: best section ${s.top_section.key} (score ${s.top_section.score})`;
    return undefined;
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
    // Follow the user if they switch script mid-chat (menus and buttons switch too). An English sentence
    // (three or more words, not Hinglish) also switches to English, so the scripted messages that follow
    // (handover, feedback) are in English too.
    const script = detectScript(query);
    const english = !script && r.language === 'en' && (query.match(/[a-z]{2,}/gi) || []).length >= 3;
    if (LANGS.includes(r.language) && r.language !== state.lang && (script === r.language || english)) {
      setLang(r.language, { announce: false });
    }
    const lang = LANGS.includes(r.language) ? r.language : state.lang;
    state.lastIntent = r.intent;
    state.lastLang = r.language;
    const low = r.confidence < LOW_CONFIDENCE;
    const action = r.action || 'none';
    const offerOfficer = action !== 'handover' && (r.escalate || low || r.intent === 'out_of_scope');
    const citations = r.citations || [];

    // In AI mode the reply stands on its own; only a handover or the PDF list can change the screen.
    const ui = action === 'handover' || (state.mode === 'ai' && action !== 'documents') ? {} : actionUi(action);
    // Suggestions are hidden when the next message is free text the app collects (complaint text).
    const collectsText = state.mode !== 'ai' && action === 'grievance';
    const suggestions = ui.list || collectsText ? [] : (r.suggested_replies || [])
      .filter((s) => !OFFICER_PATTERN.test(s))
      .map((s) => ({ id: `ask:${s}`, label: s }));
    let buttons = ui.buttons || suggestions;
    if (offerOfficer && !ui.buttons) {
      buttons = [...buttons.slice(0, 2), { id: 'officer', label: t(lang, 'talkOfficer') }];
    }

    chat.addBotMessage({
      text: r.reply,
      ai: '✦ AI',
      source: action === 'none' ? citationSource(citations, r.language === 'mixed' ? 'en' : lang) : null,
      buttons: buttons.slice(0, 3),
      list: ui.list,
    });
    record('bot', r.reply);

    const tags = [`route: ${r.route}`];
    if (action !== 'none') tags.push(`action: ${action}`);
    if (low) tags.push('low confidence');
    if (r.escalate) tags.push('escalate');
    if (r.intent === 'out_of_scope') tags.push('guardrail');
    if (r.search?.rewritten?.length) tags.push('query rewritten');
    panels.log({
      route: 'ai', query, language: r.language, intent: r.intent, confidence: r.confidence,
      sources: citations.map((c) => (c.type === 'faq' ? c.faq_id : c.key)),
      latency: r.latency_ms ?? res.latency, tags,
      label: searchNote(r),
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
      case 'topic': {
        const [key, page] = arg.split(':');
        return showTopic(key, Number(page) || 0);
      }
      case 'faq': return answerFaq(arg, label);
      case 'cmp':
        if (arg === 'new') return askComplaint();
        return askComplaintRef();
      case 'remind':
        state.statusReminders.add(arg);
        return say(L('reminderSet', { ref: arg }));
      case 'view': {
        const c = state.complaints[arg] || data.complaints.find((x) => x.ref === arg);
        return c && showComplaintCard(c, false);
      }
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
    const item = data.menu.items.find((i) => i.key === key);
    if (!item) return undefined;
    logScripted(label, key, item.faqs ? ['menu.json', 'faqs.json'] : ['menu.json']);
    if (item.faqs) return showTopic(key);
    switch (item.flow) {
      case 'complaint': return showComplaintMenu();
      case 'documents': return showDocuments();
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

    if (state.handover) {
      state.handoverPending.push(text);
      return;
    }

    if (state.mode === 'ai') return askAi(text);

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

    const ref = text.match(CMP_PATTERN);
    if (ref) return lookupComplaint(ref[0], text);

    // Short explicit requests hand over instantly (even mid-step); longer messages go to the AI, which can also hand over.
    if (OFFICER_PATTERN.test(text) && text.length < 40) return startHandover(text);

    if (state.step === 'complaint') return registerComplaint(text);

    if (PII_PATTERN.test(text)) {
      logScripted(text, 'pii_warning', [], { tags: ['pii guard'] });
      return say(L('pii'));
    }

    if (state.step === 'cmp_ref') {
      if (CMP_LOOSE.test(text) || REF_LIKE.test(text)) {
        logScripted(text, 'complaint_status', [], { tags: ['invalid format'] });
        return say(L('complaintInvalid'), { buttons: [officerBtn(), menuBtn()] });
      }
      state.step = null;
    }

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
