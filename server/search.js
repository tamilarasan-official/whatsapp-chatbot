// SEC Bihar search engine: our fine-tuned multilingual-e5-small (int8 ONNX) + BM25 keywords, fused as in meta.json.
//   searchFaq(query)        -> FAQs ranked by the best-matching unit (question / question+answer, en + hi)
//   searchSections(query)   -> Act sections / case-study entries ranked by their best chunk
//   lookupSection(message)  -> direct hit for "Section 125" / "धारा 14" / "dhara 14"
// query = { texts, vectors }: the message plus AI rewrites; scores take the max over them per key.
const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '..', 'data', 'kb');
const INDEX_DIR = path.join(KB_DIR, 'index');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const meta = readJson(path.join(INDEX_DIR, 'meta.json'));
const chunks = readJson(path.join(INDEX_DIR, 'chunks.json'));
const faqUnits = readJson(path.join(INDEX_DIR, 'faq_units.json'));
const faqs = readJson(path.join(KB_DIR, 'faqs.json'));
const sections = readJson(path.join(KB_DIR, 'sections.json'));
const faqById = new Map(faqs.map((f) => [f.id, f]));
const TAU = meta.matcher.threshold_rule.tau;
// Officials-only FAQs answer a public question only on a very clear match (direct officials questions score
// ~0.8; a public question wrongly pulled to one scored 0.6 in the Phase 5 test). The officials menu lifts this.
const OFFICIALS_TAU = 0.70;

// float16 little-endian -> Float32Array (Node 20 has no Float16Array)
function readF16(file) {
  const buf = fs.readFileSync(file);
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) {
    const h = buf.readUInt16LE(i * 2);
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    out[i] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return out;
}

const SEC = readF16(path.join(INDEX_DIR, 'sec.f16'));
const FAQ = readF16(path.join(INDEX_DIR, 'faq.f16'));
const DIMS = meta.dims;
const chunkWeight = chunks.map((c) => (c.reliability === 'low' ? meta.low_reliability_weight : 1));

// ------------------------------------------------------------ sections by key
const FAMILY = {
  panchayat_act_en: 'panchayat_act', panchayat_act_hi: 'panchayat_act',
  municipal_act_en: 'municipal_act', municipal_act_hi: 'municipal_act',
  panchayat_amendment_2021_hi: 'amend2021', panchayat_amendment_2021_en_mt: 'amend2021',
  municipal_amendment_2022_hi: 'amend2022', municipal_amendment_2022_en: 'amend2022',
};
const sectionKey = (s) => (s.doc === 'evoting_case_study_en' ? `case:${s.id.split(':')[1]}` : `${FAMILY[s.doc]}:${s.section}`);
const sectionsByKey = new Map();
for (const s of sections) {
  const k = sectionKey(s);
  if (!sectionsByKey.has(k)) sectionsByKey.set(k, []);
  sectionsByKey.get(k).push(s);
}
// Municipal Act sections changed by the 2022 amendment: 'municipal_act:23' -> 'amend2022:6'
const amendedBy = new Map(sections.filter((s) => s.amends && s.lang === 'en').map((s) => [`municipal_act:${s.amends}`, sectionKey(s)]));

// ------------------------------------------------------------ embedding model
let extractorPromise = null;
function loadModel() {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(async ({ pipeline, env }) => {
      env.localModelPath = INDEX_DIR + path.sep;
      env.allowRemoteModels = false;
      return pipeline('feature-extraction', 'model', { dtype: 'q8' }); // model/onnx/model_quantized.onnx
    });
    extractorPromise.catch(() => { extractorPromise = null; });
  }
  return extractorPromise;
}

async function embed(texts) {
  const extractor = await loadModel();
  const out = [];
  for (const t of texts) {
    const r = await extractor(meta.query_prefix + t, { pooling: 'mean', normalize: true });
    out.push(r.data);
  }
  return out;
}

function scoreRows(matrix, n, q) {
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const o = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += matrix[o + d] * q[d];
    scores[i] = dot;
  }
  return scores;
}

// ------------------------------------------------------------ BM25 (port of scripts/kb/retrieval.py)
const EN_STOP = new Set(('a an the of to in on for and or is are was were be by with at from as it this that what which who how '
  + 'can do does i my me you your we our they their there when where why will shall should may any all').split(' '));
const HI_STOP = new Set(('का की के है हैं में से को पर और या एक यह वह क्या कैसे कब कहाँ कौन तो भी ही था थी थे हो होता होती होते '
  + 'किया किये गया गयी गये कर करें करना जो जा सकता सकते सकती').split(' '));
const HI_SUFFIXES = ['ाएं', 'ाओं', 'ियों', 'ियां', 'ाने', 'ाता', 'ाती', 'ाते', 'ों', 'ें', 'ीं', 'ना', 'ने', 'नी', 'ी', 'े', 'ा', 'ो']
  .sort((a, b) => b.length - a.length);
const EN_SUFFIXES = ['ings', 'ing', 'ies', 'ied', 'es', 'ed', 's'];

const normaliseText = (text) => text.toLowerCase().normalize('NFC').replace(/़/g, '').replace(/ँ/g, 'ं');

function stem(tok) {
  const hindi = /[ऀ-ॿ]/.test(tok);
  for (const suf of hindi ? HI_SUFFIXES : EN_SUFFIXES) {
    if (tok.endsWith(suf) && tok.length - suf.length >= (hindi ? 2 : 3)) return tok.slice(0, -suf.length);
  }
  return tok;
}

function tokenize(text) {
  return (normaliseText(text).match(/[ऀ-ॿ]+|[a-z0-9]+/g) || [])
    .filter((t) => !EN_STOP.has(t) && !HI_STOP.has(t) && t.length > 1)
    .map(stem);
}

class BM25 {
  constructor(docs, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.len = [];
    this.post = new Map(); // term -> [[doc, count]]
    docs.forEach((d, i) => {
      const tf = new Map();
      for (const t of tokenize(d)) tf.set(t, (tf.get(t) || 0) + 1);
      this.len[i] = [...tf.values()].reduce((a, c) => a + c, 0);
      for (const [t, c] of tf) {
        if (!this.post.has(t)) this.post.set(t, []);
        this.post.get(t).push([i, c]);
      }
    });
    this.n = docs.length;
    this.avg = this.len.reduce((a, c) => a + c, 0) / (this.n || 1);
  }

  scores(query) {
    const s = new Float32Array(this.n);
    for (const term of new Set(tokenize(query))) {
      const list = this.post.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (this.n - list.length + 0.5) / (list.length + 0.5));
      for (const [i, c] of list) {
        s[i] += (idf * c * (this.k1 + 1)) / (c + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avg));
      }
    }
    return s;
  }
}

// Fusion from meta.json, e.g. "w0.85:e5-small-ft2+bm25" (weighted) or "dense:e5-small-ft".
const ALPHA = /^w([\d.]+):.*\+bm25$/.test(meta.fusion) ? Number(meta.fusion.match(/^w([\d.]+)/)[1]) : 1;
const secBm25 = ALPHA < 1 ? new BM25(chunks.map((c) => c.text), meta.bm25) : null;
const faqBm25 = ALPHA < 1 ? new BM25(faqUnits.map((u) => u.text), meta.bm25) : null;

// Best score per key over items (max over queries as well).
function perKeyMax(items, scoresPerQuery) {
  const best = new Map();
  for (const scores of scoresPerQuery) {
    for (let i = 0; i < items.length; i++) {
      const cur = best.get(items[i].key);
      if (!cur || scores[i] > cur.score) best.set(items[i].key, { score: scores[i], index: i });
    }
  }
  return best;
}

// Min-max normalised weighted sum over each ranking's top 100 (same as retrieval.weighted()).
function weightedFusion(dense, sparse, alpha, top = 100) {
  const norm = (m) => {
    const items = [...m.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, top);
    if (!items.length) return new Map();
    const hi = items[0][1].score;
    const lo = items[items.length - 1][1].score;
    return new Map(items.map(([k, v]) => [k, hi > lo ? (v.score - lo) / (hi - lo) : 1]));
  };
  const d = norm(dense);
  const s = norm(sparse);
  const fused = new Map();
  for (const k of new Set([...d.keys(), ...s.keys()])) fused.set(k, alpha * (d.get(k) || 0) + (1 - alpha) * (s.get(k) || 0));
  return fused;
}

// Cosine of every item for every query vector (chunk weights applied).
function denseScores(matrix, items, vectors, weights) {
  return vectors.map((q) => {
    const s = scoreRows(matrix, items.length, q);
    if (weights) for (let i = 0; i < s.length; i++) s[i] *= weights[i];
    return s;
  });
}

// Rank keys: by fused score when BM25 is on, else by cosine. Every result keeps `score` = its cosine
// (the matcher threshold and score floors are cosine-based) and `fused` = the ranking score.
function rankKeys(items, dense, texts, bm25) {
  const best = perKeyMax(items, dense);
  const fused = bm25 ? weightedFusion(best, perKeyMax(items, texts.map((t) => bm25.scores(t))), ALPHA) : null;
  return [...best.entries()]
    .map(([key, v]) => ({ key, score: v.score, index: v.index, fused: fused ? fused.get(key) || 0 : v.score }))
    .sort((a, b) => b.fused - a.fused);
}

// query = { vectors, texts }: the message (and AI rewrites) and their embeddings.
// FAQs; officials-only FAQs are left out unless includeOfficials (the officials menu) or a very clear match.
// `set` restricts the search to one FAQ set (e.g. 'evoting').
function searchFaq(query, { includeOfficials = false, limit = 3, set = null } = {}) {
  const ranked = rankKeys(faqUnits, denseScores(FAQ, faqUnits, query.vectors), query.texts, faqBm25)
    .filter((r) => !set || faqById.get(r.key).set === set);
  const top = ranked[0];
  const topIsOfficials = top && faqById.get(top.key).audience === 'officials';
  const allow = includeOfficials || (topIsOfficials && top.score >= OFFICIALS_TAU);
  return ranked
    .filter((r) => allow || faqById.get(r.key).audience !== 'officials')
    .slice(0, limit)
    .map((r) => ({ ...r, faq: faqById.get(r.key), confident: r.score >= TAU }));
}

// Sections, each with its best chunks by cosine (both languages kept, best first).
function searchSections(query, { limit = 4, chunksPerKey = 2 } = {}) {
  const dense = denseScores(SEC, chunks, query.vectors, chunkWeight);
  const ranked = rankKeys(chunks, dense, query.texts, secBm25).slice(0, limit);
  const chunkScore = (i) => Math.max(...dense.map((s) => s[i]));
  return ranked.map((r) => {
    const best = chunks.map((c, i) => [c, i]).filter(([c]) => c.key === r.key)
      .sort((x, y) => chunkScore(y[1]) - chunkScore(x[1]));
    return { key: r.key, score: r.score, fused: r.fused, chunks: best.slice(0, chunksPerKey).map(([c]) => c) };
  });
}

// ------------------------------------------------------------ direct "Section N" lookup
const DEVANAGARI_DIGITS = /[०-९]/g;
const toAscii = (s) => s.replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966));
const SECTION_REF = /(?:\bsection|\bsec\.?|\bdhara|\bdhaara|\bdhra|धारा|பிரிவு)\s*(?:no\.?\s*)?(\d{1,3}[A-Za-z]?)\b/i;
const ACT_HINTS = [
  { family: 'amend2022', re: /2022|(?:municipal|nagarpalika|नगरपालिका)\W*(?:amendment|sanshodhan|संशोधन)/i },
  { family: 'amend2021', re: /amendment|sanshodhan|संशोधन|2021/i },
  { family: 'panchayat_act', re: /panchayat|panchayath|gram|mukhiya|sarpanch|zila parishad|samiti|पंचायत|ग्राम|मुखिया|सरपंच|जिला परिषद|समिति|பஞ்சாயத்து|கிராம/i },
  { family: 'municipal_act', re: /municipal|nagarpalika|nagar|nigam|ward|councillor|parshad|ulb|नगरपालिका|नगर|निगम|पार्षद|वार्ड|நகராட்சி|மாநகராட்சி|வார்டு/i },
];

// Names an Act ("act", "bill", "अधिनियम") and asks nothing more specific than what it is, where it applies or
// for its PDF: every other word is one of these.
const ACT_WORD = /\b(acts?|bills?|law|adhiniyam|kanoon|kanun)\b|अधिनियम|विधेयक|कानून|क़ानून/i;
const ACT_LEVEL_WORDS = new Set(('what whats is are the a an of does do did where which get gets got apply applies applied '
  + 'applicable application about tell me i want need give send show share pdf pdfs download copy document documents '
  + 'doc link file full text act acts bill bills law bihar municipal municipality panchayat panchayati raj amendment '
  + 'in to for please can you it its this that area areas extent commencement when come came into force effect '
  + 'kya hai hain ka ki ke mujhe chahiye lagu hota hoti hote kahan kab se bhejo do de dijiye '
  + 'क्या है हैं का की के बिहार नगरपालिका पंचायत राज अधिनियम संशोधन कहाँ कहां लागू होता होती विस्तार पीडीएफ '
  + 'डाउनलोड मुझे चाहिए में यह इस बारे प्रति दें दीजिए भेजें भेजिए कब से कानून विधेयक बा का होला कहाँ').split(' '));

function actLevel(message) {
  if (!ACT_WORD.test(message) && !/\bpdfs?\b|पीडीएफ/i.test(message)) return false;
  const words = toAscii(message).toLowerCase().match(/[a-z]+|[ऀ-ॿ]+/g) || [];
  return words.every((w) => ACT_LEVEL_WORDS.has(w) || /^\d+$/.test(w));
}

// Returns [] (no reference), or the matching sections (more than one family = ask which Act).
// A whole-Act question returns that Act's Section 1, marked `whole`.
function lookupSection(message, history = []) {
  const m = toAscii(message).match(SECTION_REF);
  if (!m) {
    if (!actLevel(message)) return [];
    const families = ACT_HINTS.filter((h) => h.re.test(message)).map((h) => h.family).slice(0, 1);
    return families
      .map((f) => ({ key: `${f}:1`, sections: sectionsByKey.get(`${f}:1`) || [], whole: true }))
      .filter((x) => x.sections.length);
  }
  const num = m[1].toUpperCase();
  const recent = [message, ...history.slice(-4).map((h) => h.content || '')].join(' ');
  const hinted = ACT_HINTS.filter((h) => h.re.test(message)).map((h) => h.family);
  const fromHistory = hinted.length ? [] : ACT_HINTS.filter((h) => h.re.test(recent)).map((h) => h.family);
  const families = hinted.length ? hinted.slice(0, 1) : fromHistory.length ? fromHistory.slice(0, 1) : ['panchayat_act', 'municipal_act'];
  return families
    .map((f) => ({ key: `${f}:${num}`, sections: sectionsByKey.get(`${f}:${num}`) || [] }))
    .filter((x) => x.sections.length);
}

module.exports = {
  meta, faqs, faqById, sectionsByKey, amendedBy, TAU, loadModel, embed, searchFaq, searchSections, lookupSection, toAscii,
};
