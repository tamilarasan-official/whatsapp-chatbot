// SEC Bihar answer engine.
//   1. "Section N" / "धारा N" in the message      -> the section itself (route "lookup")
//   2. our model finds a confident FAQ match       -> the official FAQ answer (route "faq")
//   3. otherwise Act / case-study passages         -> grounded answer with citations (route "act")
//   4. nothing relevant                            -> chat / "I don't have that detail" (route "chat")
// Questions without a confident FAQ match are rewritten by the AI into standalone Hindi + English
// queries first (helps Hinglish and follow-ups). The AI's reply is checked: unknown citations are
// dropped; numbers not found in the sources, or facts with no citation, get one retry, then a safe reply.
const search = require('./search');
const llm = require('./llm');
const { ORG_FACTS } = require('./prompt');
const { fallbackReply } = require('./fallback');

// Score floors from scripts/verify-node-search.js: out-of-scope questions score below these (p90).
// Between WEAK_MIN and the floor a candidate is still shown to the AI, marked "weak match".
const FAQ_MIN = 0.45;
const SECTION_MIN = 0.48;
const WEAK_MIN = 0.40;
const MAX_SECTIONS = 4;
const LOOKUP_CHARS = 2500;

const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH_WORDS = new Set(('mujhe mera meri mere kya kaise kab kahan kaun kyun kyon hai hain ho hota hoti hote batao bataye bataiye chahiye '
  + 'karna kare karein karu karun kar sakta sakte sakti nahi nahin haan acha accha theek aap apna apni ji kitna kitne kitni '
  + 'wala wali milega milta milti liye mein chunav chunaw matdan namankan nirvachan').split(' '));
const LANGUAGE_NOTE = { hi: 'Hindi (Devanagari)', en: 'English', mixed: 'Hinglish (Hindi in English letters, not Devanagari)' };
const FACT_INTENTS = new Set(['faq', 'act', 'evoting', 'complaint']);
// The model ranks generic "eVoting app" questions weakly; these words also pull in the eVoting FAQs.
const EVOTING_TOPIC = /e-?voting|secbhr|\bapp\b|mobile se vote|ई-?वोटिंग|ऐप|एप/i;
const REWRITE_MIN = 0.50;

function hinglishScore(message) {
  if (DEVANAGARI.test(message)) return 0;
  return (message.toLowerCase().match(/[a-z]+/g) || []).filter((w) => HINGLISH_WORDS.has(w)).length;
}

function replyLanguage(message, preferred) {
  if (DEVANAGARI.test(message)) return 'hi';
  if (hinglishScore(message) >= 2) return 'mixed';
  if (/[a-z]{3,}/i.test(message)) return 'en';
  return preferred === 'en' ? 'en' : 'hi';
}

// ------------------------------------------------------------ sources shown to the AI
const reliabilityNote = (r) => (r === 'high' ? '' : ' (OCR / machine translation, may contain errors)');
const stripHeader = (text) => text.slice(text.indexOf('\n') + 1);
const nextId = (registry, prefix) => `${prefix}${registry.filter((r) => r.id.startsWith(prefix)).length + 1}`;

// Citation in the reply language when that version exists (Hindi for hi / Hinglish), with its PDF page.
// The English machine translation of the 2021 amendment links to the Hindi original.
function sectionCitation(id, key, lang) {
  const versions = search.sectionsByKey.get(key);
  const isCase = key.startsWith('case:');
  const want = lang === 'en' ? 'en' : 'hi';
  const sec = versions.find((s) => s.lang === want && !s.doc.endsWith('_mt'))
    || versions.find((s) => !s.doc.endsWith('_mt')) || versions[0];
  return {
    id, type: isCase ? 'case_study' : 'act', key,
    act: sec.act, section: isCase ? null : sec.section, title: sec.title, doc: sec.doc, page: sec.page ?? null,
    reliability: versions.some((s) => s.reliability === 'high') ? 'high' : sec.reliability || 'high',
  };
}

function addLookups(registry, lookups, lang) {
  for (const { key, sections } of lookups) {
    const id = nextId(registry, 'S');
    const body = sections
      .map((s) => `[${s.lang}] ${s.act}, Section ${s.section}: ${s.title}${reliabilityNote(s.reliability)}\n${s.text.slice(0, LOOKUP_CHARS)}`)
      .join('\n\n');
    registry.push({ id, text: `${id} [SECTION ASKED FOR BY THE USER]\n${body}`, citation: sectionCitation(id, key, lang) });
  }
}

function addFaqs(registry, faqHits) {
  for (const hit of faqHits) {
    const f = hit.faq;
    const id = nextId(registry, 'F');
    const label = hit.confident ? '[OFFICIAL FAQ MATCH]' : hit.score >= FAQ_MIN ? '(possibly related FAQ)' : '(weak match)';
    registry.push({
      id,
      text: `${id} ${label} ${f.source}${f.audience === 'officials' ? ' — for election officials' : ''}\n`
        + `Q (en): ${f.q_en}\nA (en): ${f.a_en}\nQ (hi): ${f.q_hi}\nA (hi): ${f.a_hi}`,
      citation: { id, type: 'faq', faq_id: f.id, title: f.q_hi, title_en: f.q_en, source: f.source, audience: f.audience },
    });
  }
}

function addSections(registry, secHits, lang) {
  const seen = new Set(registry.map((r) => r.citation.key).filter(Boolean));
  for (const hit of secHits) {
    const sec = search.sectionsByKey.get(hit.key);
    if (seen.has(hit.key) || !sec) continue;
    const id = nextId(registry, 'S');
    const head = hit.chunks[0].text.split('\n')[0] + (hit.score >= SECTION_MIN ? '' : ' (weak match)');
    const body = hit.chunks.map((c) => `[${c.lang}]${reliabilityNote(c.reliability)} ${stripHeader(c.text)}`).join('\n…\n');
    registry.push({ id, text: `${id} ${head}\n${body}`, citation: sectionCitation(id, hit.key, lang) });
  }
}

// ------------------------------------------------------------ grounding checks
const numbersIn = (text) => (search.toAscii(String(text)).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);

function unsupportedNumbers(reply, allowedText) {
  const allowed = new Set(numbersIn(allowedText));
  return [...new Set(numbersIn(reply).filter((n) => n.replace('.', '').length >= 2 && !allowed.has(n)))];
}

// Returns a correction note for the AI, or null when the reply is grounded.
function groundingProblem(result, allowedText) {
  const bad = unsupportedNumbers(result.reply, allowedText);
  if (bad.length) {
    return `Your previous draft contained these numbers that are NOT in the SOURCES: ${bad.join(', ')}. `
      + 'Remove them, or use only numbers that appear in the SOURCES.';
  }
  if (FACT_INTENTS.has(result.intent) && !result.citationIds.length) {
    return 'Your previous draft stated facts without citing any source. Cite the SOURCES that support every fact, '
      + 'or if none do, say honestly that you do not have that detail.';
  }
  return null;
}

// Official FAQ text, used when the AI is unavailable or its reply cannot be grounded.
function officialFaqReply(hit, lang) {
  const f = hit.faq;
  const en = lang === 'en';
  return {
    reply: `*${en ? f.q_en : f.q_hi}*\n${(en ? f.a_en : f.a_hi).replace(/\n\s*\n/g, '\n').replace(/^o\s+/gm, '   ◦ ')}`,
    language: en ? 'en' : 'hi', intent: 'faq', confidence: Number(hit.score.toFixed(3)),
    escalate: false, action: 'none', suggested_replies: [],
  };
}

const NO_DETAIL = {
  hi: 'क्षमा करें, इस बारे में मेरे पास सटीक जानकारी उपलब्ध नहीं है। कृपया अपने जिला निर्वाचन कार्यालय से संपर्क करें, या मैं आपको एक अधिकारी से जोड़ सकता हूँ।',
  en: "Sorry, I don't have the exact detail on this. Please contact your District Election Office, or I can connect you to an officer.",
  mixed: 'Sorry, iski exact jaankari mere paas nahi hai. Aap apne District Election Office se sampark karein, ya main aapko officer se jod sakta hoon.',
};

// ------------------------------------------------------------ retrieval
async function retrieve(message, history, includeOfficials, lang) {
  const lookups = search.lookupSection(message, history);
  let vectors = await search.embed([message]);
  let faqHits = search.searchFaq(vectors, { includeOfficials });
  let rewritten = [];
  const followUp = history.length > 0 && message.split(/\s+/).length <= 8;
  const worthRewriting = hinglishScore(message) >= 1 || followUp || (faqHits[0]?.score ?? 0) >= REWRITE_MIN;
  if (!faqHits[0]?.confident && !lookups.length && worthRewriting && llm.getClient()) {
    rewritten = await llm.rewriteQuery(message, history);
    if (rewritten.length) {
      vectors = vectors.concat(await search.embed(rewritten));
      faqHits = search.searchFaq(vectors, { includeOfficials });
    }
  }
  const secAll = search.searchSections(vectors, { limit: MAX_SECTIONS });
  const secHits = secAll.filter((h) => h.score >= SECTION_MIN);
  const weakSecs = secHits.length ? [] : secAll.filter((h) => h.score >= WEAK_MIN).slice(0, 2);
  const confidentFaq = faqHits[0]?.confident ? faqHits[0] : null;

  const registry = [];
  addLookups(registry, lookups, lang);
  let faqCandidates = confidentFaq ? [confidentFaq] : faqHits.filter((h) => h.score >= WEAK_MIN).slice(0, 2);
  if (!confidentFaq && EVOTING_TOPIC.test(`${message} ${rewritten.join(' ')}`)) {
    const evoting = search.searchFaq(vectors, { includeOfficials, set: 'evoting', limit: 2 });
    faqCandidates = faqCandidates.concat(evoting.filter((e) => !faqCandidates.some((c) => c.key === e.key)));
  }
  addFaqs(registry, faqCandidates);
  addSections(registry, confidentFaq ? secHits.slice(0, 2) : secHits.concat(weakSecs), lang);
  return {
    registry, confidentFaq,
    route: lookups.length ? 'lookup' : confidentFaq ? 'faq' : secHits.length ? 'act' : 'chat',
    debug: {
      rewritten,
      top_faq: faqHits[0] ? { id: faqHits[0].key, score: Number(faqHits[0].score.toFixed(3)) } : null,
      top_section: secAll[0] ? { key: secAll[0].key, score: Number(secAll[0].score.toFixed(3)) } : null,
    },
  };
}

// ------------------------------------------------------------ main entry
async function respond({ message, history = [], language = 'hi', context = {}, mode = 'static' }) {
  const started = performance.now();
  const lang = replyLanguage(message, language);
  const { registry, confidentFaq, route, debug } = await retrieve(message, history, context.audience === 'officials', lang);

  const finish = (result, citationIds = []) => {
    const citations = registry.filter((r) => citationIds.includes(r.id)).map((r) => r.citation);
    return {
      ...result,
      sources: citations.filter((c) => c.type === 'faq').map((c) => c.faq_id),
      citations,
      route: citations.length ? route : 'chat', // route = what the reply actually used
      search: { ...debug, retrieval_route: route },
      latency_ms: Math.round(performance.now() - started),
    };
  };
  const safeReply = () => (confidentFaq ? finish(officialFaqReply(confidentFaq, lang), ['F1'])
    : finish({ reply: NO_DETAIL[lang], language: lang, intent: 'faq', confidence: 0.3, escalate: true, action: 'none', suggested_replies: [] }));

  if (!llm.getClient()) {
    if (confidentFaq) return finish(officialFaqReply(confidentFaq, lang), ['F1']);
    return finish({ ...fallbackReply(lang === 'en' ? 'en' : 'hi', 'OPENAI_API_KEY is not set') });
  }

  const sources = registry.map((r) => r.text).join('\n\n');
  const allowedText = [sources, ORG_FACTS, message, ...history.map((h) => h.content || '')].join('\n');
  const validIds = new Set(registry.map((r) => r.id));
  const tagged = `${message}\n\n[Reply language: ${LANGUAGE_NOTE[lang]}]`;
  const ask = (note) => llm.answer({ message: tagged, history, language: lang, context, mode, sources: sources || null, validIds, note });

  try {
    let result = await ask();
    let problem = groundingProblem(result, allowedText);
    if (problem) {
      console.warn(`[answer] ${problem.split(':')[0].split('.')[0]} - retrying`);
      result = await ask(problem);
      problem = groundingProblem(result, allowedText);
      if (problem) {
        console.warn(`[answer] still ungrounded - safe reply`);
        return safeReply();
      }
    }
    const { citationIds, ...rest } = result;
    return finish(rest, citationIds);
  } catch (err) {
    if (!confidentFaq) throw err;
    console.warn(`[answer] AI failed (${err.message}) - official FAQ text`);
    return safeReply();
  }
}

module.exports = { respond, replyLanguage, unsupportedNumbers };
