// SEC Bihar search engine: our fine-tuned multilingual-e5-small (int8 ONNX) + the Phase 2 index.
//   searchFaq(vectors)      -> FAQs ranked by the best-matching unit (question / question+answer, en + hi)
//   searchSections(vectors) -> Act sections / case-study entries ranked by their best chunk
//   lookupSection(message)  -> direct hit for "Section 125" / "धारा 14" / "dhara 14"
// Several query vectors (original + AI rewrites) are combined by taking the max score per key.
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
};
const sectionKey = (s) => (s.doc === 'evoting_case_study_en' ? `case:${s.id.split(':')[1]}` : `${FAMILY[s.doc]}:${s.section}`);
const sectionsByKey = new Map();
for (const s of sections) {
  const k = sectionKey(s);
  if (!sectionsByKey.has(k)) sectionsByKey.set(k, []);
  sectionsByKey.get(k).push(s);
}

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

// max over query vectors, then max over units/chunks sharing a key
function rank(matrix, items, vectors, weights) {
  const best = new Map();
  for (const q of vectors) {
    const scores = scoreRows(matrix, items.length, q);
    for (let i = 0; i < items.length; i++) {
      const s = scores[i] * (weights ? weights[i] : 1);
      const cur = best.get(items[i].key);
      if (!cur || s > cur.score) best.set(items[i].key, { key: items[i].key, score: s, index: i });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

// FAQs; officials-only FAQs are left out unless includeOfficials (the officials menu or a confident match).
// `set` restricts the search to one FAQ set (e.g. 'evoting').
function searchFaq(vectors, { includeOfficials = false, limit = 3, set = null } = {}) {
  const ranked = rank(FAQ, faqUnits, vectors).filter((r) => !set || faqById.get(r.key).set === set);
  const top = ranked[0];
  const topIsOfficials = top && faqById.get(top.key).audience === 'officials';
  const allow = includeOfficials || (topIsOfficials && top.score >= TAU);
  return ranked
    .filter((r) => allow || faqById.get(r.key).audience !== 'officials')
    .slice(0, limit)
    .map((r) => ({ ...r, faq: faqById.get(r.key), confident: r.score >= TAU }));
}

// Sections, each with its best chunks (both languages kept, best first).
function searchSections(vectors, { limit = 4, chunksPerKey = 2 } = {}) {
  const perChunk = [];
  for (const q of vectors) {
    const scores = scoreRows(SEC, chunks.length, q);
    for (let i = 0; i < chunks.length; i++) perChunk[i] = Math.max(perChunk[i] ?? -1, scores[i] * chunkWeight[i]);
  }
  const byKey = new Map();
  chunks.forEach((c, i) => {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push({ chunk: c, score: perChunk[i] });
  });
  return [...byKey.entries()]
    .map(([key, list]) => {
      list.sort((a, b) => b.score - a.score);
      return { key, score: list[0].score, chunks: list.slice(0, chunksPerKey).map((x) => x.chunk) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ------------------------------------------------------------ direct "Section N" lookup
const DEVANAGARI_DIGITS = /[०-९]/g;
const toAscii = (s) => s.replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966));
const SECTION_REF = /(?:\bsection|\bsec\.?|\bdhara|\bdhaara|\bdhra|धारा)\s*(?:no\.?\s*)?(\d{1,3}[A-Za-z]?)\b/i;
const ACT_HINTS = [
  { family: 'amend2021', re: /amendment|sanshodhan|संशोधन|2021/i },
  { family: 'panchayat_act', re: /panchayat|panchayath|gram|mukhiya|sarpanch|zila parishad|samiti|पंचायत|ग्राम|मुखिया|सरपंच|जिला परिषद|समिति/i },
  { family: 'municipal_act', re: /municipal|nagar|nigam|ward|councillor|parshad|ulb|नगर|निगम|पार्षद|वार्ड/i },
];

// Returns [] (no reference), or the matching sections (more than one family = ask which Act).
function lookupSection(message, history = []) {
  const m = toAscii(message).match(SECTION_REF);
  if (!m) return [];
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
  meta, faqs, faqById, sectionsByKey, TAU, loadModel, embed, searchFaq, searchSections, lookupSection, toAscii,
};
