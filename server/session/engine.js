// Server-side conversation engine for WhatsApp: the scripted flows of public/js/flows.js (consent,
// language, menu, FAQ lists, complaints, Act PDFs, STOP/START, PII guard, officer handover) plus the
// answer engine for free text. Pure with respect to I/O: handleInbound() returns the messages to send.
//   createEngine({ data, store, respond, assetsBase, ... }).handleInbound(msg) -> { messages, session }
const { t, faqText, pick, detectScript, LANGS } = require('./strings');
const { clip, LIMITS } = require('../whatsapp/limits');

const CMP_PATTERN = /\bCMP-\d{4}-\d{5}\b/i;
const CMP_LOOSE = /\bCMP[\s-]*\d/i;
const PII_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b|\b\d{10,}\b|\b(otp|password|passcode|pin)\b.*\d{4,}/i;
// Explicit requests for a person only. "returning officer", "polling agent", "presiding officer" are election
// terms and must reach the answer engine, so a bare officer/agent word counts only as the whole message or
// together with a talk/connect verb.
const OFFICER_PATTERN = /^(officer|agent|adhikari|अधिकारी|इंसान)[\s!.?]*$|\b(talk|speak|chat|connect|call|baat|bat)\b.{0,25}\b(officer|human|person|agent|adhikari|someone)\b|\b(human|real person|live agent|customer care)\b|अधिकारी से (बात|संपर्क)|किसी इंसान/i;
const MENU_PATTERN = /^(menu|main menu|start over|मेन्यू|मेनू|मुख्य मेन्यू)[\s!.]*$/i;
const GREETING_PATTERN = /^(hi+|hello|hey|help|namaste|namaskar|नमस्ते|नमस्कार|प्रणाम)[\s!.]*$/i;
const REF_LIKE = /^[a-z]{0,4}[\s-]*\d[\d\s-]{2,}$/i;
const LANG_WORDS = { en: /^(english|eng|अंग्रेज़ी|अंग्रेजी)$/i, hi: /^(hindi|हिन्दी|हिंदी)$/i };
const STOP_WORDS = /^(stop|unsubscribe|रोकें|बंद करें)[\s!.]*$/i;
const START_WORDS = /^(start|subscribe|शुरू करें)[\s!.]*$/i;
// Short acknowledgements typed instead of tapping a language button ("ok", "👍", "haan"): go on in Hindi.
const ACK_PATTERN = /^(ok|okay|k|hmm+|haan|han|ha|ji|yes|y|theek|thik|sahi|ठीक|हाँ|हां|जी)[\s!.]*$|^[^\p{L}\p{N}]+$/iu;
const PAGE_SIZE = 9; // list rows hold 10: 9 questions + "More questions"
const MAX_MESSAGE_LENGTH = 500; // same cap as /api/chat
const LOW_CONFIDENCE = 0.5;
const HANDOVER_NOTICE_GAP_MS = 10 * 60 * 1000;
const WINDOW_24H = 24 * 60 * 60 * 1000;

const maskPhone = (p) => `…${String(p).slice(-4)}`;

function createEngine({ data, store, respond, assetsBase, handoverTtlMs = 60 * 60 * 1000, now = Date.now, onHandover, log = console.log }) {
  const faqById = new Map(data.faqs.map((f) => [f.id, f]));
  const docByKey = new Map(data.documents.map((d) => [d.doc, d]));
  const defaultLang = data.org.defaultLanguage || 'hi';
  const langOf = (s) => (LANGS.includes(s.lang) ? s.lang : defaultLang);
  const orgName = (s) => (langOf(s) === 'hi' ? data.org.orgNameHi : data.org.orgName);
  const dateLabel = () => new Date(now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- per-turn context: the session plus the outbound messages collected for it ----------

  function ctx(s) {
    const out = [];
    const L = (key, vars) => t(langOf(s), key, vars);
    const remember = (choices) => { s.lastChoices = choices.map((c) => ({ id: c.id, title: c.title })); };
    return {
      s, out, L,
      text: (text) => out.push({ type: 'text', text }),
      buttons: (text, buttons) => { remember(buttons); out.push({ type: 'buttons', text, buttons, short: L('whatNext') }); },
      list: (text, button, sections, short) => { remember(sections.flatMap((x) => x.rows)); out.push({ type: 'list', text, button, sections, short: short || L('whatNext') }); },
      document: (doc) => out.push({ type: 'document', ...doc }),
    };
  }

  const record = (s, role, content) => { s.history.push({ role, content: String(content).slice(0, 1000) }); };
  const officerBtn = (c, lang) => ({ id: 'officer', title: t(lang || langOf(c.s), 'talkOfficer') });
  const menuBtn = (c) => ({ id: 'menu', title: c.L('mainMenu') });

  // ---------- consent, language, menu ----------

  // First contact: consent + language buttons. Returns true when the user's message was consumed by it.
  function start(c) {
    const { s } = c;
    s.started = true;
    if (s.consentAt && LANGS.includes(s.lang)) return false; // returning user: carry on with the message
    s.step = 'lang';
    c.buttons(`${c.L('consent', { org: orgName(s) })}\n\n${c.L('chooseLang')}`,
      LANGS.map((code) => ({ id: `lang:${code}`, title: t(code, 'langName') })));
    return true;
  }

  function menuSections(c) {
    const rows = data.menu.items.map((item) => ({
      id: `menu:${item.key}`, title: pick(langOf(c.s), item, 'title'), description: pick(langOf(c.s), item, 'desc'),
    }));
    return [{ title: c.L('menuSection'), rows }];
  }

  function showMenu(c, intro) {
    c.s.step = null;
    c.s.audience = null;
    c.list(intro || c.L('howHelp'), c.L('viewOptions'), menuSections(c));
  }

  function chooseLang(c, lang) {
    const { s } = c;
    s.lang = lang;
    s.step = null;
    if (!s.consentAt) s.consentAt = now();
    const pending = s.pending;
    s.pending = null;
    if (pending && !GREETING_PATTERN.test(pending) && !MENU_PATTERN.test(pending)) return handleText(c, pending, { record: false });
    return showMenu(c);
  }

  // ---------- FAQ lists and answers ----------

  function topicRows(c, item, page) {
    const lang = langOf(c.s);
    const ids = item.faqs.filter((id) => faqById.has(id));
    const shown = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const rows = shown.map((id, i) => {
      const n = page * PAGE_SIZE + i + 1;
      const q = faqText(lang, faqById.get(id)).question;
      const title = clip(`${n}. ${q}`, LIMITS.ROW_TITLE);
      return { id: `faq:${id}`, title, description: title.endsWith('…') ? clip(q, LIMITS.ROW_DESCRIPTION) : '', n, q };
    });
    if (ids.length > (page + 1) * PAGE_SIZE) {
      rows.push({ id: `topic:${item.key}:${page + 1}`, title: c.L('moreQuestions'), description: c.L('moreQuestionsDesc') });
    }
    return rows;
  }

  function showTopic(c, key, page = 0) {
    const item = data.menu.items.find((i) => i.key === key);
    if (!item?.faqs) return;
    c.s.step = null;
    c.s.audience = item.audience || null;
    const topic = pick(langOf(c.s), item, 'title');
    const intro = page > 0 ? c.L('moreQuestionsDesc') : c.L(item.audience === 'officials' ? 'officialsIntro' : 'topicIntro', { topic });
    const rows = topicRows(c, item, page);
    const numbered = rows.filter((r) => r.n).map((r) => `${r.n}. ${r.q}`).join('\n');
    c.list(`${intro}\n\n${numbered}`, c.L('viewQuestions'), [{ title: clip(topic, LIMITS.SECTION_TITLE), rows }], intro);
  }

  function answerFaq(c, id) {
    const faq = faqById.get(id);
    if (!faq) return;
    const lang = langOf(c.s);
    const { question, answer } = faqText(lang, faq);
    const text = `*${question}*\n${answer}\n\n${c.L('source')}: ${c.L('sourceFaq')} · ${pick(lang, faq, 'category')}`;
    c.buttons(text, [menuBtn(c), officerBtn(c)]);
    c.s.lastIntent = 'faq';
  }

  // ---------- complaints ----------

  function showComplaintMenu(c) {
    c.s.step = null;
    c.buttons(c.L('complaintIntro'), [
      { id: 'cmp:new', title: c.L('complaintNew') },
      { id: 'cmp:status', title: c.L('complaintStatus') },
      { id: 'faq:municipal_21', title: c.L('complaintHow') },
    ]);
  }

  function registerComplaint(c, text) {
    const { s } = c;
    s.step = null;
    const ticket = `CMP-${new Date(now()).getFullYear()}-${String(store.nextComplaintSeq()).padStart(5, '0')}`;
    s.lastTicket = ticket;
    s.lastComplaint = ticket;
    s.complaints[ticket] = {
      ref: ticket, complainant: c.L('complainantYou'), category: text.slice(0, 60),
      statusKey: 'registered', updated: dateLabel(), office: c.L('officeDefault'), text: text.slice(0, 500), createdAt: now(),
    };
    c.text(c.L('complaintDone', { ticket }));
    askFeedback(c);
    s.lastIntent = 'complaint';
  }

  function lookupComplaint(c, ref) {
    const { s } = c;
    s.step = null;
    ref = ref.toUpperCase();
    const rec = s.complaints[ref] || data.complaints.find((x) => x.ref === ref) || null;
    if (!rec) return c.buttons(c.L('complaintNotFound', { ref }), [officerBtn(c), menuBtn(c)]);
    s.lastComplaint = ref;
    s.lastIntent = 'complaint_status';
    return showComplaintCard(c, rec, true);
  }

  function showComplaintCard(c, rec, withFollowUp) {
    const { s } = c;
    const lang = langOf(s);
    const statusKey = s.statusOverrides[rec.ref] || rec.statusKey;
    const card = c.L('complaintCard', {
      ref: rec.ref, status: c.L(`statusNames.${statusKey}`), applicant: rec.complainant,
      category: pick(lang, rec, 'category'), updated: s.statusOverrides[rec.ref] ? c.L('today') : rec.updated, office: pick(lang, rec, 'office'),
    });
    if (withFollowUp && statusKey !== 'approved') {
      return c.buttons(`${card}\n\n${c.L('complaintFollow')}`, [{ id: `remind:${rec.ref}`, title: c.L('remindMe') }, officerBtn(c)]);
    }
    return c.buttons(card, [menuBtn(c)]);
  }

  // ---------- documents (Acts) ----------

  function showDocuments(c) {
    const lang = langOf(c.s);
    const rows = data.documents.map((d, i) => ({
      id: `doc:${d.id}`, title: clip(`${i + 1}. ${pick(lang, d, 'title')}`, LIMITS.ROW_TITLE), description: clip(`${pick(lang, d, 'title')} · ${d.pages} p.`, LIMITS.ROW_DESCRIPTION),
    }));
    const numbered = data.documents.map((d, i) => `${i + 1}. ${pick(lang, d, 'title')}`).join('\n');
    c.list(`${c.L('docsIntro')}\n\n${numbered}`, c.L('viewDocs'), [{ title: clip(c.L('docsTitle'), LIMITS.SECTION_TITLE), rows }], c.L('docsIntro'));
  }

  function sendDocument(c, id) {
    const doc = data.documents.find((d) => d.id === id);
    if (!doc) return;
    const title = pick(langOf(c.s), doc, 'title');
    c.document({ link: `${assetsBase}/${doc.file}`, filename: `${title.replace(/[\\/:*?"<>|]/g, '')}.pdf`, caption: c.L('docSent') });
    askFeedback(c);
    c.s.lastIntent = 'document';
  }

  function askFeedback(c) {
    c.buttons(c.L('helpful'), [{ id: 'fb:yes', title: c.L('yes') }, { id: 'fb:no', title: c.L('no') }]);
  }

  // ---------- officer handover ----------

  function startHandover(c, reason) {
    const { s } = c;
    if (s.handover) return;
    s.handover = true;
    s.handoverAt = now();
    s.handoverNoticeAt = now();
    s.handoverReason = reason;
    s.step = null;
    c.text(c.L('handover'));
    notifyHandover({ phone: s.phone, name: s.name, lang: langOf(s), reason, complaint: s.lastComplaint, transcript: s.history.slice(-20) });
  }

  function notifyHandover(payload) {
    if (!onHandover) return;
    try { Promise.resolve(onHandover(payload)).catch((err) => console.warn(`[wa] handover hook failed: ${err.message}`)); } catch (err) { console.warn(`[wa] handover hook failed: ${err.message}`); }
  }

  // While an officer owns the chat the bot stays quiet, apart from a periodic "forwarded" note.
  // "menu" returns to the bot; an expired handover (no officer reply within HANDOVER_TTL_MIN) does too.
  function inHandover(c, text) {
    const { s } = c;
    if (MENU_PATTERN.test(text)) { s.handover = false; return showMenu(c); }
    if (now() - s.handoverAt > handoverTtlMs) { s.handover = false; return handleText(c, text, { record: false }); }
    notifyHandover({ phone: s.phone, name: s.name, lang: langOf(s), reason: 'message during handover', message: text });
    if (now() - (s.handoverNoticeAt || 0) >= HANDOVER_NOTICE_GAP_MS) {
      s.handoverNoticeAt = now();
      c.text(c.L('handoverWaiting'));
    }
    return undefined;
  }

  // ---------- AI ----------

  function citationLine(citations, lang) {
    if (!citations?.length) return '';
    const cit = citations[0];
    const more = citations.length > 1 ? ` · ${t(lang, 'moreSources', { n: citations.length - 1 })}` : '';
    const src = t(lang, 'source');
    if (cit.type === 'faq') return `${src}: ${t(lang, 'sourceFaq')} · ${lang === 'hi' ? cit.title : cit.title_en}${more}`;
    if (cit.type === 'case_study') return `${src}: ${t(lang, 'caseStudy')} · ${cit.title}${more}`;
    const doc = docByKey.get(cit.doc);
    const url = doc ? `\n${assetsBase}/${doc.file}${cit.page ? `#page=${cit.page}` : ''}` : '';
    const caution = cit.reliability && cit.reliability !== 'high' ? ` · ⚠ ${t(lang, 'verifyNote')}` : '';
    return `${src}: ${cit.act} · ${t(lang, 'sourceAct')} ${cit.section} – ${cit.title}${more}${caution}${url}`;
  }

  async function askAi(c, text) {
    const { s } = c;
    const history = s.history.slice(0, -1); // the current message is appended by the answer engine
    let r;
    try {
      r = await respond({
        message: text, history, language: langOf(s), mode: 'static',
        context: { ticket: s.lastTicket || undefined, audience: s.audience || undefined, optedOut: s.optedOut },
      });
    } catch (err) {
      console.warn(`[wa] answer failed for ${maskPhone(s.phone)}: ${err.message}`);
      r = null;
    }
    renderAiReply(c, text, r);
  }

  function renderAiReply(c, query, r) {
    const { s } = c;
    if (!r?.reply || r.fallback) {
      const lang = detectScript(query) || langOf(s);
      record(s, 'assistant', t(lang, 'fallback'));
      return c.buttons(t(lang, 'fallback'), [officerBtn(c, lang)]);
    }
    if (LANGS.includes(r.language) && r.language !== s.lang && detectScript(query) === r.language) s.lang = r.language;
    const lang = LANGS.includes(r.language) ? r.language : langOf(s);
    s.lastIntent = r.intent;
    const action = r.action || 'none';
    const low = r.confidence < LOW_CONFIDENCE;
    const offerOfficer = action !== 'handover' && (r.escalate || low || r.intent === 'out_of_scope');
    record(s, 'assistant', r.reply);
    log(`[wa] ${maskPhone(s.phone)} ${r.route} ${r.intent}/${action} ${r.language} conf=${r.confidence} ${r.latency_ms ?? '-'}ms`);

    if (action === 'handover') { c.text(r.reply); return startHandover(c, 'AI detected request for a human'); }
    if (action === 'menu' || action === 'faq_list') { c.text(r.reply); return showMenu(c); }
    if (action === 'grievance') { s.step = 'complaint'; return c.text(r.reply); }

    const src = citationLine(r.citations, lang === 'mixed' ? 'en' : lang);
    const reply = src ? `${r.reply}\n\n${src}` : r.reply;
    const buttons = (r.suggested_replies || []).filter((x) => !OFFICER_PATTERN.test(x))
      .map((x) => ({ id: `ask:${x}`, title: clip(x, LIMITS.BUTTON_TITLE) })).slice(0, offerOfficer ? 2 : LIMITS.BUTTONS);
    if (offerOfficer) buttons.push(officerBtn(c, lang));
    return buttons.length ? c.buttons(reply, buttons) : c.text(reply);
  }

  // ---------- input handling ----------

  async function handleAction(c, id, title, { record: rec = true } = {}) {
    const { s } = c;
    if (rec && title) record(s, 'user', title);
    if (!s.started && start(c)) return;
    const [kind, arg = ''] = id.split(/:(.*)/s);
    if (s.handover && !(kind === 'menu' && !arg) && kind !== 'officer') return inHandover(c, title || '');

    switch (kind) {
      case 'lang': return LANGS.includes(arg) ? chooseLang(c, arg) : showMenu(c);
      case 'menu': return arg ? openMenuItem(c, arg) : showMenu(c);
      case 'topic': { const [key, page] = arg.split(':'); return showTopic(c, key, Number(page) || 0); }
      case 'faq': return answerFaq(c, arg);
      case 'cmp': if (arg === 'new') { s.step = 'complaint'; return c.text(c.L('complaintAsk')); } s.step = 'cmp_ref'; return c.text(c.L('askComplaintRef'));
      case 'remind': if (!s.reminders.includes(arg)) s.reminders.push(arg); return c.text(c.L('reminderSet', { ref: arg }));
      case 'view': { const rec2 = s.complaints[arg] || data.complaints.find((x) => x.ref === arg); return rec2 ? showComplaintCard(c, rec2, false) : showMenu(c); }
      case 'doc': return sendDocument(c, arg);
      case 'fb': return arg === 'yes' ? c.text(c.L('thanksYes')) : c.buttons(c.L('thanksNo'), [officerBtn(c), menuBtn(c)]);
      case 'officer': return startHandover(c, 'User request');
      case 'ask': return handleText(c, arg, { record: false });
      default: return showMenu(c);
    }
  }

  function openMenuItem(c, key) {
    const item = data.menu.items.find((i) => i.key === key);
    if (!item) return showMenu(c);
    if (item.faqs) return showTopic(c, key);
    switch (item.flow) {
      case 'complaint': return showComplaintMenu(c);
      case 'documents': return showDocuments(c);
      case 'officer': return startHandover(c, 'User request');
      default: return showMenu(c);
    }
  }

  async function handleText(c, raw, { record: rec = true, fresh = false } = {}) {
    const { s } = c;
    const text = String(raw || '').trim();
    if (!text) return undefined;
    if (rec) record(s, 'user', text);

    if (STOP_WORDS.test(text)) { s.optedOut = true; s.optedOutAt = now(); s.started = true; return c.text(c.L('optedOut')); }
    if (START_WORDS.test(text)) { s.optedOut = false; if (!s.started && start(c)) return undefined; return c.text(c.L('optedIn')); }

    if (!s.started && start(c)) { s.pending = text; return undefined; }
    if (s.handover) return inHandover(c, text);

    if (s.step === 'lang') {
      const lang = LANGS.find((code) => LANG_WORDS[code].test(text));
      if (lang) return chooseLang(c, lang);
      if (ACK_PATTERN.test(text)) return chooseLang(c, detectScript(text) || defaultLang);
      s.step = null;
      if (detectScript(text)) s.lang = detectScript(text);
      if (!s.consentAt) s.consentAt = now();
    }

    const pickN = /^\d{1,2}$/.test(text) ? s.lastChoices[Number(text) - 1] : null;
    if (pickN) return handleAction(c, pickN.id, pickN.title, { record: false });

    if (MENU_PATTERN.test(text) || (fresh && GREETING_PATTERN.test(text))) return showMenu(c, fresh ? c.L('welcomeBack', { org: orgName(s) }) : undefined);

    const ref = text.match(CMP_PATTERN);
    if (ref) return lookupComplaint(c, ref[0]);

    // Short explicit requests hand over at once; longer messages go to the AI, which can also hand over.
    if (OFFICER_PATTERN.test(text) && text.length < 40) return startHandover(c, 'User request');

    if (s.step === 'complaint') return registerComplaint(c, text);

    if (PII_PATTERN.test(text)) return c.text(c.L('pii'));

    if (s.step === 'cmp_ref') {
      if (CMP_LOOSE.test(text) || REF_LIKE.test(text)) return c.buttons(c.L('complaintInvalid'), [officerBtn(c), menuBtn(c)]);
      s.step = null;
    }

    if (text.length > MAX_MESSAGE_LENGTH) return c.text(c.L('tooLong', { max: MAX_MESSAGE_LENGTH }));
    return askAi(c, text);
  }

  // ---------- public API ----------

  // msg: a parsed inbound message (server/whatsapp/parse.js). Returns the messages to send to msg.from.
  async function handleInbound(msg) {
    const s = store.get(msg.from);
    if (msg.name) s.name = msg.name;
    const fresh = !s.started;
    s.lastInboundAt = now();
    const c = ctx(s);
    try {
      if (!['text', 'interactive', 'button'].includes(msg.type)) {
        if (!s.started) start(c); else if (!s.handover) c.text(c.L('unsupported'));
      } else if (msg.replyId) {
        await handleAction(c, msg.replyId, msg.text);
      } else {
        await handleText(c, msg.text, { fresh });
      }
    } finally {
      s.lastBotAt = c.out.length ? now() : s.lastBotAt;
      store.save(s);
    }
    return { messages: c.out, session: s };
  }

  // Officer console: reply as the officer (keeps the bot quiet), or close the handover.
  function agentReply(phone, text) {
    const s = store.get(phone);
    if (!s.lastInboundAt) return null;
    const c = ctx(s);
    s.handover = true;
    s.handoverAt = s.handoverAt || now();
    record(s, 'assistant', text);
    c.text(`${c.L('officerPrefix')}\n${text}`);
    store.save(s);
    return c.out;
  }

  function agentClose(phone) {
    const s = store.get(phone);
    if (!s.lastInboundAt) return null;
    const c = ctx(s);
    s.handover = false;
    c.text(c.L('handoverEnd'));
    askFeedback(c);
    store.save(s);
    return c.out;
  }

  // Proactive complaint update. Inside the 24-hour window a normal message is allowed; outside it only an
  // approved template may be sent (templateName from WHATSAPP_TEMPLATE_COMPLAINT_UPDATE). Honours STOP.
  function notify(phone, { ref, statusKey = 'approved', templateName }) {
    const s = store.get(phone);
    if (s.optedOut) return { ok: false, reason: 'opted_out' };
    if (!statusKey || !t('en', `statusNames.${statusKey}`)) return { ok: false, reason: 'bad_status' };
    const c = ctx(s);
    s.statusOverrides[ref] = statusKey;
    const status = c.L(`statusNames.${statusKey}`);
    const inWindow = s.lastInboundAt && now() - s.lastInboundAt < WINDOW_24H;
    if (inWindow) {
      c.buttons(c.L('notifyBody', { ref, status }), [{ id: `view:${ref}`, title: c.L('viewDetails') }]);
    } else if (templateName) {
      c.out.push({ type: 'template', name: templateName, language: langOf(s) === 'en' ? 'en' : 'hi',
        components: [{ type: 'body', parameters: [{ type: 'text', text: ref }, { type: 'text', text: status }] }] });
    } else {
      return { ok: false, reason: 'template_required' };
    }
    record(s, 'assistant', c.L('notifyBody', { ref, status }));
    store.save(s);
    return { ok: true, messages: c.out, viaTemplate: !inWindow };
  }

  return { handleInbound, agentReply, agentClose, notify };
}

module.exports = { createEngine, PII_PATTERN, OFFICER_PATTERN, MENU_PATTERN };
