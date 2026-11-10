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

// Score floors (cosine) from scripts/verify-node-search.js with the Phase 5 model: out-of-scope questions
// score below these (p90: FAQ 0.44, section 0.36); case-study questions score above (p10 0.43).
// Between WEAK_MIN and the floor a candidate is still shown to the AI, marked "weak match".
const FAQ_MIN = 0.45;
const SECTION_MIN = 0.40;
const WEAK_MIN = 0.36;
const MAX_SECTIONS = 4;
const WEB_PAGES = 2; // pages of the website documents added to every answer's sources
const LOOKUP_CHARS = 2500;

const DEVANAGARI = /[ऀ-ॿ]/;
// Romanised Hindi words. English look-alikes ("me", "to", "do", "so") are left out so English questions
// are not mistaken for Hinglish; two hits mark a message as Hinglish.
const HINGLISH_WORDS = new Set(('mujhe mera meri mere kya kaise kab kahan kaun kyun kyon kis hai hain ho hota hoti hote '
  + 'batao bataye bataiye bataiye chahiye karna kare karein karu karun kar karte karke sakta sakte sakti nahi nahin '
  + 'haan acha accha theek aap apna apni apne ji kitna kitne kitni wala wali wale milega milegi milenge milta milti '
  + 'liye mein ki ka ke ko se par aur agar toh kuch sab bhai jata jaata jati jaati jate jaate diya diye hua hue hui '
  + 'raha rahi rahe rahega rahegi gaye gayi chale aaya aaye aata aati lagta lagti lagte dena dene lena lene bharein '
  + 'bharna dalne dalna wapas pehle baad andar seedhe janta chunti chune chunav chunaw matdan namankan nirvachan '
  + 'ummeedwar ummeedwaron sadasya saal waqt yojana zaroori jankari jaankari').split(' '));
// Romanised Tamil (Tanglish) words; two hits mark a message as Tanglish.
const TANGLISH_WORDS = new Set(('enna eppadi epdi enaku enakku ennoda naan nan unga ungaloda ungal venum vendum irukku '
  + 'iruka irukka illa illai pannanum pannunga panna pannalaama sollunga sollu evlo evvalavu eppo enga yaaru yaar '
  + 'romba nandri vanakkam seri sari aagum aaguma podanum poda kudunga theriyuma theriyala mudiyuma mudiyum '
  + 'vote-a votu therthal therdhal vetpalar vaakkalar').split(' '));
const TAMIL = /[஀-௿]/;
const LANGUAGE_NOTE = {
  hi: 'Hindi (Devanagari)', en: 'English', ta: 'Tamil (Tamil script)',
  mixed: 'Hinglish (Hindi in English letters, not Devanagari)',
  tanglish: 'Tanglish (Tamil in English letters, not Tamil script)',
};
const FACT_INTENTS = new Set(['faq', 'act', 'evoting', 'complaint']);
// The model ranks generic "eVoting app" questions weakly; these words also pull in the eVoting FAQs.
const EVOTING_TOPIC = /e-?voting|secbhr|\bapp\b|mobile se vote|ई-?वोटिंग|ऐप|एप/i;
const REWRITE_MIN = 0.50;
const MULTI_PART = /\?[^?]+\?|\b(?:and|also|aur|tatha|evam)\b|और|तथा|एवं|साथ ही/i;
const SECTION_CHARS = 2500; // a matched section up to this length is shown whole, not only its best chunks
const FAQ_SAFE = 0.70; // FAQ score above which the official text may stand in for a failed AI reply

function romanScore(message, words) {
  if (DEVANAGARI.test(message) || TAMIL.test(message)) return 0;
  return (message.toLowerCase().match(/[a-z]+/g) || []).filter((w) => words.has(w)).length;
}
const hinglishScore = (message) => romanScore(message, HINGLISH_WORDS);
const tanglishScore = (message) => romanScore(message, TANGLISH_WORDS);

// The reply's language from its script (the AI's own label is not reliable): Devanagari -> hi, Tamil -> ta;
// Latin -> "mixed" if it reads as romanised Hindi or Tamil, else English.
function scriptLanguage(reply) {
  const letters = (reply.match(/\p{L}/gu) || []).length || 1;
  if ((reply.match(/[ऀ-ॿ]/g) || []).length / letters > 0.5) return 'hi';
  if ((reply.match(/[஀-௿]/g) || []).length / letters > 0.5) return 'ta';
  return Math.max(hinglishScore(reply), tanglishScore(reply)) >= 2 ? 'mixed' : 'en';
}

// forced: the app asked for this language (e.g. an FAQ tapped in Tamil, sent as its English question).
function replyLanguage(message, preferred, forced) {
  if (['hi', 'en'].includes(forced)) return forced;
  if (DEVANAGARI.test(message)) return 'hi';
  if (TAMIL.test(message) || tanglishScore(message) >= 2) return preferred === 'en' ? 'en' : 'hi';
  if (hinglishScore(message) >= 2) return 'mixed';
  if (/[a-z]{3,}/i.test(message)) return 'en';
  return preferred === 'en' ? 'en' : 'hi';
}

// ------------------------------------------------------------ sources shown to the AI
const reliabilityNote = (r) => (r === 'high' ? '' : ' (OCR / machine translation, may contain errors)');
const stripHeader = (text) => text.slice(text.indexOf('\n') + 1);
const nextId = (registry, prefix) => `${prefix}${registry.filter((r) => r.id.startsWith(prefix)).length + 1}`;

// Citation in the reply language when that version exists (Hindi for hi / Hinglish, else English), with its PDF page.
// The English machine translation of the 2021 amendment links to the Hindi original.
function sectionCitation(id, key, lang) {
  const versions = search.sectionsByKey.get(key);
  const isCase = key.startsWith('case:');
  const want = lang === 'hi' || lang === 'mixed' ? 'hi' : 'en';
  const sec = versions.find((s) => s.lang === want && !s.doc.endsWith('_mt'))
    || versions.find((s) => !s.doc.endsWith('_mt')) || versions[0];
  if (sec.url) { // a document from the Commission's website: link to its page there
    return {
      id, type: 'web_doc', key, act: sec.act, section: null, title: sec.title, doc: sec.doc, page: sec.page,
      url: `${sec.url}#page=${sec.page}`, host: 'sec.bihar.gov.in', reliability: sec.reliability || 'high',
    };
  }
  return {
    id, type: isCase ? 'case_study' : 'act', key,
    act: sec.act, section: isCase ? null : sec.section, title: sec.title, doc: sec.doc, page: sec.page ?? null,
    reliability: versions.some((s) => s.reliability === 'high') ? 'high' : sec.reliability || 'high',
  };
}

function addLookups(registry, lookups, lang) {
  for (const { key, sections, whole, previous } of lookups) {
    if (registry.some((r) => r.citation.key === key)) continue;
    const id = nextId(registry, 'S');
    const label = previous ? '[SOURCE OF YOUR PREVIOUS ANSWER]' : whole
      ? '[THE ACT THE USER ASKED ABOUT: its Section 1 gives the name, where it applies and when it came into force; '
        + 'the app attaches the PDF of this Act]'
      : '[SECTION ASKED FOR BY THE USER]';
    const body = sections
      .map((s) => `[${s.lang}] ${s.act}, Section ${s.section}: ${s.title}${reliabilityNote(s.reliability)}\n${s.text.slice(0, LOOKUP_CHARS)}`)
      .join('\n\n');
    registry.push({ id, text: `${id} ${label}\n${body}`, citation: sectionCitation(id, key, lang) });
  }
}

function addFaqs(registry, faqHits) {
  for (const hit of faqHits) {
    const f = hit.faq;
    if (registry.some((r) => r.citation.faq_id === f.id)) continue;
    const id = nextId(registry, 'F');
    const label = hit.previous ? '[SOURCE OF YOUR PREVIOUS ANSWER]' : hit.confident ? '[OFFICIAL FAQ MATCH]'
      : hit.score >= FAQ_MIN ? '(possibly related FAQ)' : '(weak match)';
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
    if (hit.key.startsWith('amend2022:')) {
      addAmendment(registry, hit.key, lang);
      continue;
    }
    const id = nextId(registry, 'S');
    const head = hit.chunks[0].text.split('\n')[0] + (hit.score >= SECTION_MIN ? '' : ' (weak match)');
    // The whole section when it is short enough (a proviso in another chunk can decide the answer),
    // in the reply language when that version exists; else its best-matching chunks.
    const want = lang === 'hi' || lang === 'mixed' ? 'hi' : 'en';
    const whole = sec.find((s) => s.lang === want && !s.doc.endsWith('_mt')) || sec.find((s) => s.lang === hit.chunks[0].lang) || sec[0];
    const body = whole.text.length <= SECTION_CHARS
      ? `[${whole.lang}]${reliabilityNote(whole.reliability)} ${whole.text}`
      : hit.chunks.map((c) => `[${c.lang}]${reliabilityNote(c.reliability)} ${stripHeader(c.text)}`).join('\n…\n');
    registry.push({ id, text: `${id} ${head}\n${body}`, citation: sectionCitation(id, hit.key, lang) });
  }
}

// A section of the 2022 Municipal amendment, in full (its provisos decide the answer and are short).
function addAmendment(registry, key, lang, changes) {
  const want = lang === 'hi' || lang === 'mixed' ? 'hi' : 'en';
  const versions = search.sectionsByKey.get(key);
  const s = versions.find((v) => v.lang === want) || versions[0];
  const id = nextId(registry, 'S');
  const label = changes
    ? `[AMENDMENT IN FORCE: changes ${changes}; where they differ, this is the current law]`
    : '[AMENDMENT IN FORCE: where it differs from the 2007 Act, this is the current law]';
  registry.push({
    id, citation: sectionCitation(id, key, lang),
    text: `${id} ${label}\n[${s.lang}] ${s.act}, Section ${s.section}: ${s.title}\n${s.text.slice(0, LOOKUP_CHARS)}`,
  });
}

// A Municipal Act section changed by the 2022 amendment is followed by the amending section: the law in force.
function addAmendments(registry, lang) {
  for (const r of registry.slice()) {
    const key = search.amendedBy.get(r.citation.key);
    if (key && !registry.some((x) => x.citation.key === key)) addAmendment(registry, key, lang, r.id);
  }
}

// ------------------------------------------------------------ suggested follow-up questions
// Letters and digits only, so the AI's copy matches the source despite spacing, quotes or punctuation.
const lettersOnly = (text) => String(text).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
const EVIDENCE_MIN = 20; // letters: a few real words, not "yes"

function answerableSuggestions(suggestions, registry) {
  const kept = suggestions.filter((s) => {
    const evidence = lettersOnly(s.evidence);
    const source = registry.find((r) => r.id === s.source);
    return source && evidence.length >= EVIDENCE_MIN && lettersOnly(source.text).includes(evidence);
  });
  if (kept.length < suggestions.length) {
    console.log(`[suggest] dropped ${suggestions.length - kept.length}: `
      + suggestions.filter((s) => !kept.includes(s)).map((s) => s.q).join(' | '));
  }
  return kept.map((s) => s.q);
}

// ------------------------------------------------------------ grounding checks
const numbersIn = (text) => (search.toAscii(String(text)).replace(/(\d),(?=\d)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);

// Number words in the sources ("पाँच सौ", "six months", "two thousand") count as allowed digits.
const UNITS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, पॉच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, ग्यारह: 11,
  बारह: 12, पंद्रह: 15, पन्द्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80, नब्बे: 90,
};
const MULTIPLIERS = { hundred: 100, thousand: 1000, lakh: 100000, सौ: 100, हज़ार: 1000, हजार: 1000, लाख: 100000 };

function wordNumbers(text) {
  const out = [];
  const words = String(text).toLowerCase().split(/[^\p{L}\p{M}]+/u);
  for (let i = 0; i < words.length; i++) {
    const unit = UNITS[words[i]];
    if (unit === undefined) continue;
    out.push(String(unit));
    const mult = MULTIPLIERS[words[i + 1]];
    if (mult) out.push(String(unit * mult));
  }
  return out;
}

function unsupportedNumbers(reply, allowedText) {
  const allowed = new Set([...numbersIn(allowedText), ...wordNumbers(allowedText)]);
  return [...new Set(numbersIn(reply).filter((n) => n.replace('.', '').length >= 2 && !allowed.has(n)))];
}

// Returns a correction note for the AI, or null when the reply is grounded.
function groundingProblem(result, allowedText) {
  const bad = unsupportedNumbers(result.reply, allowedText);
  if (bad.length) {
    return `Your previous draft contained these numbers that are NOT in the SOURCES: ${bad.join(', ')}. `
      + 'Remove them, or use only numbers that appear in the SOURCES.';
  }
  // Offering the PDF list states only which documents the app has (ABOUT THE COMMISSION), not facts from them.
  if (result.action === 'documents') return null;
  // factual intent, or a long reply mislabelled as small talk
  const factual = FACT_INTENTS.has(result.intent)
    || (result.intent === 'smalltalk' && result.reply.split(/\s+/).length > 40);
  if (factual && !result.citationIds.length) {
    return 'Your previous draft stated facts without citing any source. Cite the SOURCES that support every fact, '
      + 'or if none do, say honestly that you do not have that detail.';
  }
  return null;
}

// Official FAQ text, used when the AI is unavailable or its reply cannot be grounded.
// Official text in Hindi (hi / Hinglish), Tamil when translated (ta), else English.
function officialFaqReply(hit, lang) {
  const f = hit.faq;
  const l = lang === 'hi' || lang === 'mixed' ? 'hi' : lang === 'ta' && f.a_ta ? 'ta' : 'en';
  return {
    reply: `*${f[`q_${l}`]}*\n${f[`a_${l}`].replace(/\n\s*\n/g, '\n').replace(/^o\s+/gm, '   ◦ ')}`,
    language: l, intent: 'faq', confidence: Number(hit.score.toFixed(3)),
    escalate: false, action: 'none', suggested_replies: [],
  };
}

// When neither the documents nor the official websites answer: where the detail is published, and an officer.
const NO_DETAIL = {
  hi: 'यह जानकारी आयोग के दस्तावेज़ों में मुझे नहीं मिली। इसकी सटीक जानकारी आयोग की वेबसाइट *sec.bihar.gov.in*, आपके निर्वाची पदाधिकारी / जिला निर्वाचन कार्यालय या टोल-फ्री हेल्पलाइन *1800-345-7243* से मिल सकती है। चाहें तो मैं आपको अभी एक अधिकारी से जोड़ सकता हूँ।',
  en: "This detail isn't in the Commission's documents I can search. You can get it on the Commission's website *sec.bihar.gov.in*, from your Returning Officer / District Election Office, or on the toll-free helpline *1800-345-7243*. I can also connect you to an officer now.",
  mixed: 'Ye detail Commission ke documents me nahi mili. Aap iski sahi jaankari *sec.bihar.gov.in* website, apne Returning Officer / District Election Office, ya toll-free helpline *1800-345-7243* se le sakte hain. Chahein to main abhi aapko officer se jod sakta hoon.',
  ta: 'மன்னிக்கவும், இது குறித்த சரியான தகவல் என்னிடம் இல்லை. உங்கள் மாவட்ட தேர்தல் அலுவலகத்தைத் தொடர்பு கொள்ளவும், அல்லது உங்களை ஒரு அலுவலருடன் இணைக்கலாம்.',
  tanglish: 'Sorry, idhu pathi correct-aana thagaval ennidam illai. Unga District Election Office-a contact pannunga, illa naan ungala oru officer-oda connect panren.',
};

// ------------------------------------------------------------ retrieval
// Everyday words for posts that the Acts name differently, added as an extra search text.
const POST_TERMS = [
  [/\bdeputy\s+mayor\b|उप\s*(?:मेयर|महापौर)/i, 'Deputy Chief Councillor उप मुख्य पार्षद'],
  [/\bmayor\b|मेयर|महापौर/i, 'Chief Councillor मुख्य पार्षद'],
];
const MAYOR_POST = /\b(?:deputy\s+)?(?:mayor|chief\s+councill?or)\b|मेयर|महापौर|मुख्य\s*पार्षद/i;
const REMOVAL = /\bno[\s-]*confidence\b|\bavishwas\b|अविश्वास|\bremov|हटा/i;
// Extra search texts in the Acts' wording. A topic gets the section title on its own: added to the
// question, it is diluted (e.g. "no confidence motion against the Mayor" did not find Section 25).
function actWording(message) {
  const extra = POST_TERMS.filter(([re]) => re.test(message)).map(([, words]) => words);
  const texts = extra.length ? [`${message} (${extra.join(', ')})`] : [];
  if (MAYOR_POST.test(message) && REMOVAL.test(message)) {
    texts.push('Removal of Chief Councillor/Deputy Chief Councillor, no confidence motion, '
      + 'मुख्य पार्षद/उप मुख्य पार्षद को हटाया जाना, अविश्वास प्रस्ताव');
  }
  return texts;
}

// The sources of the previous AI answer (sent back by the app): a follow-up, such as a tapped suggestion,
// is answered from the same sources it was suggested from.
function previousSources(ids = []) {
  const faqs = ids.map((id) => search.faqById.get(id)).filter(Boolean)
    .map((faq) => ({ faq, key: faq.id, score: 0, previous: true }));
  const sections = ids.filter((id) => search.sectionsByKey.has(id))
    .map((key) => ({ key, sections: search.sectionsByKey.get(key), previous: true }));
  return { faqs, sections };
}

async function retrieve(message, history, includeOfficials, lang, prevIds = []) {
  const lookups = search.lookupSection(message, history);
  const texts = [message, ...actWording(message)];
  const query = { texts, vectors: await search.embed(texts) };
  let faqHits = search.searchFaq(query, { includeOfficials });
  let rewritten = [];
  const followUp = history.length > 0 && message.split(/\s+/).length <= 8;
  // Tamil / Tanglish are always rewritten: the search model was fine-tuned on Hindi and English.
  const tamil = TAMIL.test(message) || tanglishScore(message) >= 1;
  const worthRewriting = tamil || hinglishScore(message) >= 1 || followUp || (faqHits[0]?.score ?? 0) >= REWRITE_MIN;
  // A question with two parts ("fee and last date?") is split, even next to a confident FAQ for one part.
  const multiPart = MULTI_PART.test(message) && message.split(/\s+/).length >= 6;
  if ((multiPart || (!faqHits[0]?.confident && worthRewriting)) && !lookups.length && llm.getClient()) {
    rewritten = await llm.rewriteQuery(message, history);
    if (rewritten.length) {
      query.texts.push(...rewritten);
      query.vectors.push(...(await search.embed(rewritten)));
      faqHits = search.searchFaq(query, { includeOfficials });
    }
  }
  const secAll = search.searchSections(query, { limit: MAX_SECTIONS });
  const secHits = secAll.filter((h) => h.score >= SECTION_MIN);
  const weakSecs = secHits.length ? [] : secAll.filter((h) => h.score >= WEAK_MIN).slice(0, 2);
  const webHits = search.searchSections(query, { limit: WEB_PAGES, only: (k) => k.startsWith('web:') })
    .filter((h) => h.score >= WEAK_MIN);
  const confidentFaq = faqHits[0]?.confident ? faqHits[0] : null;

  const registry = [];
  addLookups(registry, lookups, lang);
  let faqCandidates = confidentFaq ? [confidentFaq] : faqHits.filter((h) => h.score >= WEAK_MIN).slice(0, 2);
  if (!confidentFaq && EVOTING_TOPIC.test(`${message} ${rewritten.join(' ')}`)) {
    const evoting = search.searchFaq(query, { includeOfficials, set: 'evoting', limit: 2 });
    faqCandidates = faqCandidates.concat(evoting.filter((e) => !faqCandidates.some((c) => c.key === e.key)));
  }
  addFaqs(registry, faqCandidates);
  // Act sections next to an FAQ match too, so a more specific question (e.g. the Mayor post) gets its detail.
  addSections(registry, confidentFaq ? secHits.slice(0, 3) : secHits.concat(weakSecs), lang);
  // The website documents (rules, handbooks, code of conduct) have their own slots: next to the Acts and
  // FAQs they rank low (OCR text, many similar pages) although they hold the procedural detail.
  if (!lookups.length) addSections(registry, webHits, lang);
  if (history.length && prevIds.length) {
    const prev = previousSources(prevIds);
    addFaqs(registry, prev.faqs);
    addLookups(registry, prev.sections, lang);
  }
  addAmendments(registry, lang);
  return {
    registry, confidentFaq, wholeAct: lookups.some((l) => l.whole),
    route: lookups.length ? 'lookup' : confidentFaq ? 'faq' : secHits.length ? 'act' : 'chat',
    debug: {
      rewritten,
      top_faq: faqHits[0] ? { id: faqHits[0].key, score: Number(faqHits[0].score.toFixed(3)) } : null,
      top_section: secAll[0] ? { key: secAll[0].key, score: Number(secAll[0].score.toFixed(3)) } : null,
    },
  };
}

// ------------------------------------------------------------ main entry
// withSources (tests only, never from the API): also return the full text of every source shown to the AI.
async function respond({ message, history = [], language = 'hi', context = {}, mode = 'static', withSources = false }) {
  // context.replyLanguage: set by the app when it sends an FAQ's English question for a Tamil user
  const started = performance.now();
  const lang = replyLanguage(message, language, context.replyLanguage);
  const { registry, confidentFaq, wholeAct, route, debug } = await retrieve(message, history, context.audience === 'officials', lang,
    context.prevSources);

  // webPages: official pages found by the website search, shown as sources after the documents'
  const finish = (result, citationIds = [], webPages = []) => {
    const citations = registry.filter((r) => citationIds.includes(r.id)).map((r) => r.citation)
      .concat(webPages.map((p, i) => ({ id: `W${i + 1}`, type: 'web', title: p.title, url: p.url, host: llm.officialHost(p.url) })));
    return {
      ...result,
      sources: citations.filter((c) => c.type === 'faq').map((c) => c.faq_id),
      citations,
      route: webPages.length ? 'web' : citations.length ? route : 'chat', // route = what the reply actually used
      search: { ...debug, retrieval_route: route },
      latency_ms: Math.round(performance.now() - started),
      ...(withSources ? { source_texts: registry.map((r) => ({ id: r.id, cited: citationIds.includes(r.id), text: r.text })) } : {}),
    };
  };
  // The official websites, when the documents do not answer (null if they do not either).
  const fromWebsite = async () => {
    const web = await llm.webAnswer({ message, history, languageName: LANGUAGE_NOTE[lang] });
    if (!web) return null;
    console.log(`[web] answered from ${web.pages.map((p) => p.url).join(' ')}`);
    return finish({ reply: web.reply, language: scriptLanguage(web.reply), intent: 'faq', confidence: 0.7, escalate: false,
      action: 'none', suggested_replies: [] }, [], web.pages);
  };
  // A safe reply repeats the official FAQ only when the match is very strong; otherwise the official websites,
  // then where to find the detail.
  const safeReply = async () => (confidentFaq && confidentFaq.score >= FAQ_SAFE ? finish(officialFaqReply(confidentFaq, lang), ['F1'])
    : (await fromWebsite())
      || finish({ reply: NO_DETAIL[lang], language: lang, intent: 'faq', confidence: 0.3, escalate: true, action: 'none', suggested_replies: [],
        coverage: 'none' }));

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
      console.warn(`[answer] retrying: ${problem.split('. ')[0]}`);
      result = await ask(problem);
      problem = groundingProblem(result, allowedText);
      if (problem) {
        console.warn(`[answer] still ungrounded - safe reply`);
        return safeReply();
      }
    }
    const { citationIds, ...rest } = result;
    // A request for a whole Act always shows the PDF list (the AI sometimes says "shared" without the action).
    if (wholeAct && rest.action === 'none') rest.action = 'documents';
    // Source ids belong in "citations"; drop any the AI also wrote into the text ("... [S1]",
    // 'Citations: ["S1","S2"]'), and source labels such as "[AMENDMENT IN FORCE]".
    rest.reply = rest.reply.replace(/\s*(?:citations?\s*:\s*)?\[(?:\s*"?[FS]\d+"?\s*,?)+\]/gi, '')
      .replace(/\s*\[(?:AMENDMENT IN FORCE|OFFICIAL FAQ MATCH|SOURCE OF YOUR PREVIOUS ANSWER|SECTION ASKED FOR BY THE USER)[^\]]*\]/g, '')
      .replace(/\s*\[[^\]]*$/, '') // an unclosed "[" left at the end
      .replace(/\*\*([^*]+)\*\*/g, '*$1*') // WhatsApp bold is one star
      .trim();
    // Follow-up buttons only on answers from sources, and only those whose evidence is in their source:
    // a suggestion the sources cannot answer ends in "I don't have the detail" when tapped.
    rest.suggested_replies = citationIds.length ? answerableSuggestions(rest.suggested_replies, registry) : [];
    // The documents do not fully answer a factual question: the official websites may.
    if (FACT_INTENTS.has(rest.intent) && rest.coverage !== 'full') {
      const web = await fromWebsite();
      if (web) return web;
    }
    return finish({ ...rest, language: scriptLanguage(rest.reply) }, citationIds);
  } catch (err) {
    if (!confidentFaq) throw err;
    console.warn(`[answer] AI failed (${err.message}) - official FAQ text`);
    return safeReply();
  }
}

module.exports = { respond, replyLanguage, unsupportedNumbers };
