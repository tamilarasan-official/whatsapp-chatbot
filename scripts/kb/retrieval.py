"""Phase 2 - Retrieval building blocks: chunking, BM25, char n-gram TF-IDF, dense embeddings, fusion.

Two search tasks share these pieces:
  FAQ task      : rank the 68 FAQs (each FAQ = several units: Q-en, Q-hi, Q+A-en, Q+A-hi, keywords; score = max)
  Section task  : rank Act sections / case-study entries (each = 1..n chunks; score = max), key = "family:section"
"""
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict

import numpy as np
from common import OUT, WORK

FAMILY = {'panchayat_act_en': 'panchayat_act', 'panchayat_act_hi': 'panchayat_act',
          'municipal_act_en': 'municipal_act', 'municipal_act_hi': 'municipal_act',
          'panchayat_amendment_2021_hi': 'amend2021', 'panchayat_amendment_2021_en_mt': 'amend2021'}
DEVANAGARI = re.compile(r'[ऀ-ॿ]')
MAX_CHARS = {'en': 1200, 'hi': 900}   # ~300 tokens for the embedding models


# ---------------------------------------------------------------- chunking

def section_key(s):
    if s['doc'] == 'evoting_case_study_en':
        return 'case:' + s['id'].split(':', 1)[1]
    return f"{FAMILY[s['doc']]}:{s['section']}"


def header(s):
    if s['doc'] == 'evoting_case_study_en':
        return f"eVoting Case Study (Bihar ULB elections 2025) › {s['title']}"
    return f"{s['act']} › Section {s['section']} › {s['title']}"


def split_text(text, limit):
    """Split at sub-section markers / blank lines / sentence ends into chunks of <= limit characters."""
    parts = re.split(r'\n(?=\(\d+\)|\([a-z]\)|\([ivx]+\))|\n\s*\n|(?<=[.।])\s+', text)
    chunks, cur = [], ''
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if cur and len(cur) + len(p) + 1 > limit:
            chunks.append(cur)
            cur = p
        else:
            cur = f'{cur}\n{p}' if cur else p
        while len(cur) > limit * 1.5:  # a single very long part
            cut = cur.rfind(' ', 0, limit)
            chunks.append(cur[:cut if cut > 100 else limit])
            cur = cur[cut if cut > 100 else limit:].strip()
    if cur:
        chunks.append(cur)
    return chunks


def load_corpora():
    sections = json.loads((OUT / 'sections.json').read_text(encoding='utf-8'))
    faqs = json.loads((OUT / 'faqs.json').read_text(encoding='utf-8'))
    sec_chunks = []
    for s in sections:
        for i, body in enumerate(split_text(s['text'], MAX_CHARS.get(s['lang'], 1200))):
            sec_chunks.append({'key': section_key(s), 'id': f"{s['id']}#{i}", 'lang': s['lang'],
                               'reliability': s.get('reliability', 'high'), 'text': f"{header(s)}\n{body}"})
    faq_units = []
    for f in faqs:
        units = [('q_en', f['q_en']), ('q_hi', f['q_hi']), ('qa_en', f"{f['q_en']}\n{f['a_en']}"),
                 ('qa_hi', f"{f['q_hi']}\n{f['a_hi']}")]
        if f['keywords_en'] or f['keywords_hi']:
            units.append(('kw', ', '.join(f['keywords_en'] + f['keywords_hi'])))
        for kind, text in units:
            if text.strip():
                faq_units.append({'key': f['id'], 'kind': kind, 'audience': f['audience'], 'text': text})
    return sec_chunks, faq_units, faqs, sections


# ---------------------------------------------------------------- lexical: BM25 + char n-grams

EN_STOP = set('a an the of to in on for and or is are was were be by with at from as it this that what which who how '
              'can do does i my me you your we our they their there when where why will shall should may any all'.split())
HI_STOP = set('का की के है हैं में से को पर और या एक यह वह क्या कैसे कब कहाँ कौन तो भी ही था थी थे हो होता होती होते '
              'किया किये गया गयी गये कर करें करना जो जा सकता सकते सकती'.split())
HI_SUFFIXES = sorted(['ाएं', 'ाओं', 'ियों', 'ियां', 'ाने', 'ाता', 'ाती', 'ाते', 'ों', 'ें', 'ीं', 'ना', 'ने', 'नी',
                      'ी', 'े', 'ा', 'ो'], key=len, reverse=True)


def normalise(text):
    text = unicodedata.normalize('NFC', text.lower())
    text = text.replace('़', '').replace('ँ', 'ं')  # nukta / chandrabindu variants
    return text


def stem(tok):
    if DEVANAGARI.search(tok):
        for suf in HI_SUFFIXES:
            if tok.endswith(suf) and len(tok) - len(suf) >= 2:
                return tok[:-len(suf)]
        return tok
    for suf in ('ings', 'ing', 'ies', 'ied', 'es', 'ed', 's'):
        if tok.endswith(suf) and len(tok) - len(suf) >= 3:
            return tok[:-len(suf)]
    return tok


def tokenize(text):
    toks = re.findall(r'[ऀ-ॿ]+|[a-z0-9]+', normalise(text))
    return [stem(t) for t in toks if t not in EN_STOP and t not in HI_STOP and len(t) > 1]


class BM25:
    def __init__(self, docs, k1=1.2, b=0.75):
        self.k1, self.b = k1, b
        self.tf = [Counter(tokenize(d)) for d in docs]
        self.len = np.array([sum(t.values()) for t in self.tf], dtype=float)
        self.avg = self.len.mean() if len(self.len) else 1.0
        df = Counter(term for t in self.tf for term in t)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        self.post = defaultdict(list)
        for i, t in enumerate(self.tf):
            for term, c in t.items():
                self.post[term].append((i, c))

    def scores(self, query):
        s = np.zeros(len(self.tf))
        for term in set(tokenize(query)):
            idf = self.idf.get(term)
            if idf is None:
                continue
            for i, c in self.post[term]:
                s[i] += idf * c * (self.k1 + 1) / (c + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
        return s


class CharTfidf:
    def __init__(self, docs):
        from sklearn.feature_extraction.text import TfidfVectorizer
        self.vec = TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), sublinear_tf=True, min_df=2,
                                   preprocessor=normalise, dtype=np.float32)
        self.m = self.vec.fit_transform(docs)

    def scores(self, query):
        return (self.m @ self.vec.transform([query]).T).toarray().ravel()


# ---------------------------------------------------------------- dense embeddings (cached)

MODELS = {
    'e5-small': ('intfloat/multilingual-e5-small', 'query: ', 'passage: '),
    'e5-base': ('intfloat/multilingual-e5-base', 'query: ', 'passage: '),
    'bge-m3': ('BAAI/bge-m3', '', ''),
    'minilm': ('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', '', ''),
}
for _base, (_name, _qp, _pp) in list(MODELS.items()):  # fine-tuned versions produced by finetune.py
    if (WORK / 'models' / f'{_base}-secbihar').exists():
        MODELS[f'{_base}-ft'] = (str(WORK / 'models' / f'{_base}-secbihar'), _qp, _pp)
_loaded = {}


def model(name):
    if name not in _loaded:
        from sentence_transformers import SentenceTransformer
        m = SentenceTransformer(MODELS[name][0], device='cpu')
        m.max_seq_length = 512
        _loaded[name] = m
    return _loaded[name]


def embed_corpus(name, texts, tag):
    """Passage embeddings, cached on disk by model + corpus hash."""
    digest = hashlib.md5('\x00'.join(texts).encode('utf-8')).hexdigest()[:12]
    path = WORK / 'emb' / f'{name}-{tag}-{digest}.npy'
    if path.exists():
        return np.load(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _, _, p_prefix = MODELS[name]
    order = np.argsort([len(t) for t in texts])  # length-sorted batches are much faster on CPU
    vecs = model(name).encode([p_prefix + texts[i] for i in order], batch_size=16, normalize_embeddings=True,
                              show_progress_bar=False, convert_to_numpy=True)
    out = np.zeros_like(vecs)
    out[order] = vecs
    np.save(path, out.astype(np.float32))
    return out.astype(np.float32)


def embed_queries(name, queries):
    _, q_prefix, _ = MODELS[name]
    return model(name).encode([q_prefix + q for q in queries], batch_size=32, normalize_embeddings=True,
                              show_progress_bar=False, convert_to_numpy=True).astype(np.float32)


# ---------------------------------------------------------------- aggregation and fusion

def aggregate(scores, keys, weights=None):
    """Max score per key -> (sorted keys, scores)."""
    best = {}
    for i, k in enumerate(keys):
        v = scores[i] * (weights[i] if weights is not None else 1.0)
        if k not in best or v > best[k]:
            best[k] = v
    ranked = sorted(best.items(), key=lambda kv: -kv[1])
    return ranked


def rrf(rankings, k=60, top=100):
    fused = defaultdict(float)
    for ranking in rankings:
        for r, (key, _) in enumerate(ranking[:top]):
            fused[key] += 1.0 / (k + r + 1)
    return sorted(fused.items(), key=lambda kv: -kv[1])


def weighted(dense_ranking, sparse_ranking, alpha, top=100):
    def norm(ranking):
        items = ranking[:top]
        if not items:
            return {}
        hi, lo = items[0][1], items[-1][1]
        return {k: (v - lo) / (hi - lo) if hi > lo else 1.0 for k, v in items}
    d, s = norm(dense_ranking), norm(sparse_ranking)
    keys = set(d) | set(s)
    return sorted(((k, alpha * d.get(k, 0) + (1 - alpha) * s.get(k, 0)) for k in keys), key=lambda kv: -kv[1])
