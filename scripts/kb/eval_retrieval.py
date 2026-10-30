"""Phase 2 - Compare retrieval methods on the evaluation set.

Methods: BM25, char n-gram TF-IDF, dense (e5-small, e5-base, bge-m3, MiniLM), hybrids (RRF and weighted).
Tasks:  FAQ task (faq questions -> right FAQ) and Section task (act/case questions -> right section/entry).
Metrics: Recall@1/@3/@5, MRR@10, nDCG@10, per split (dev/test) and language (en/hi/hl).

Usage: python eval_retrieval.py [model ...]      (default: all downloaded models)
Output: kb-work/phase2/results.json, rankings cache for the matcher/reranker steps
"""
import json
import math
import pickle
import sys
import time

import numpy as np
from common import OUT, WORK
from retrieval import (MODELS, BM25, CharTfidf, aggregate, embed_corpus, embed_queries, load_corpora, rrf,
                       weighted)

RESULTS = WORK / 'phase2'
LOW_RELIABILITY_WEIGHT = 0.85


def rank_of(ranking, gold, k=10):
    for r, (key, _) in enumerate(ranking[:k]):
        if key in gold:
            return r + 1
    return None


def ndcg10(ranking, gold):
    dcg = sum(1 / math.log2(r + 2) for r, (key, _) in enumerate(ranking[:10]) if key in gold)
    idcg = sum(1 / math.log2(r + 2) for r in range(min(len(gold), 10)))
    return dcg / idcg if idcg else 0.0


def metrics(rows):
    """rows: list of (ranking, gold set)."""
    if not rows:
        return {}
    ranks = [rank_of(r, g) for r, g in rows]
    n = len(rows)
    return {
        'n': n,
        'R@1': round(sum(1 for x in ranks if x == 1) / n, 3),
        'R@3': round(sum(1 for x in ranks if x and x <= 3) / n, 3),
        'R@5': round(sum(1 for x in ranks if x and x <= 5) / n, 3),
        'MRR': round(sum(1 / x for x in ranks if x) / n, 3),
        'nDCG': round(sum(ndcg10(r, g) for r, g in rows) / n, 3),
    }


def breakdown(questions, rankings, task):
    out = {}
    sel = [q for q in questions if (q['type'] == 'faq') == (task == 'faq') and q['type'] in
           (('faq',) if task == 'faq' else ('act', 'case'))]
    for split in ('dev', 'test', 'all'):
        for lang in ('all', 'en', 'hi', 'hl'):
            rows = [(rankings[q['id']], set(q['gold_faq'] if task == 'faq' else q['gold_sections']))
                    for q in sel if (split == 'all' or q['split'] == split) and (lang == 'all' or q['lang'] == lang)]
            m = metrics(rows)
            if m:
                out[f'{split}/{lang}'] = m
    return out


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    RESULTS.mkdir(parents=True, exist_ok=True)
    questions = json.loads((OUT / 'eval' / 'questions.json').read_text(encoding='utf-8'))
    sec_chunks, faq_units, faqs, _ = load_corpora()
    sec_texts = [c['text'] for c in sec_chunks]
    sec_keys = [c['key'] for c in sec_chunks]
    sec_w = np.array([LOW_RELIABILITY_WEIGHT if c['reliability'] == 'low' else 1.0 for c in sec_chunks])
    faq_texts = [u['text'] for u in faq_units]
    faq_keys = [u['key'] for u in faq_units]
    qtext = [q['text'] for q in questions]
    print(f'corpus: {len(sec_chunks)} section chunks, {len(faq_units)} FAQ units; {len(questions)} questions')

    # lexical
    t = time.time()
    lex = {}
    for name, cls in (('bm25', BM25), ('char', CharTfidf)):
        s_idx, f_idx = cls(sec_texts), cls(faq_texts)
        lex[name] = {'sec': [aggregate(s_idx.scores(q), sec_keys, sec_w) for q in qtext],
                     'faq': [aggregate(f_idx.scores(q), faq_keys) for q in qtext]}
    print(f'lexical indexes + scoring: {time.time() - t:.0f}s')

    wanted = sys.argv[1:] or list(MODELS)
    dense = {}
    for name in wanted:
        t = time.time()
        try:
            S = embed_corpus(name, sec_texts, 'sec')
            F = embed_corpus(name, faq_texts, 'faq')
        except OSError as e:
            print(f'{name}: not available ({e.__class__.__name__}), skipped')
            continue
        t_corpus = time.time() - t
        t = time.time()
        Q = embed_queries(name, qtext)
        per_query_ms = (time.time() - t) / len(qtext) * 1000
        dense[name] = {'sec': [aggregate(S @ Q[i], sec_keys, sec_w) for i in range(len(qtext))],
                       'faq': [aggregate(F @ Q[i], faq_keys) for i in range(len(qtext))],
                       'faq_cos': F @ Q.T, 'query_ms': round(per_query_ms, 1), 'corpus_s': round(t_corpus)}
        print(f'{name}: corpus {t_corpus:.0f}s, {per_query_ms:.0f} ms/query', flush=True)

    # assemble methods
    methods = {'bm25': lex['bm25'], 'char': lex['char']}
    for name, d in dense.items():
        methods[f'dense:{name}'] = {'sec': d['sec'], 'faq': d['faq']}
        for task in ('sec', 'faq'):
            pass
        methods[f'rrf:{name}+bm25'] = {task: [rrf([d[task][i], lex['bm25'][task][i]]) for i in range(len(qtext))]
                                        for task in ('sec', 'faq')}
        methods[f'rrf:{name}+bm25+char'] = {task: [rrf([d[task][i], lex['bm25'][task][i], lex['char'][task][i]])
                                                   for i in range(len(qtext))] for task in ('sec', 'faq')}
        for alpha in (0.5, 0.7, 0.85):
            methods[f'w{alpha}:{name}+bm25'] = {task: [weighted(d[task][i], lex['bm25'][task][i], alpha)
                                                        for i in range(len(qtext))] for task in ('sec', 'faq')}

    results = {}
    for mname, m in methods.items():
        rk_faq = {q['id']: m['faq'][i] for i, q in enumerate(questions)}
        rk_sec = {q['id']: m['sec'][i] for i, q in enumerate(questions)}
        results[mname] = {'faq': breakdown(questions, rk_faq, 'faq'), 'sec': breakdown(questions, rk_sec, 'sec')}
        if mname.startswith('dense:'):
            results[mname]['query_ms'] = dense[mname[6:]]['query_ms']
            results[mname]['corpus_s'] = dense[mname[6:]]['corpus_s']

    (RESULTS / 'results.json').write_text(json.dumps(results, indent=1), encoding='utf-8')
    with open(RESULTS / 'rankings.pkl', 'wb') as fh:  # reused by the matcher / reranker steps
        pickle.dump({'methods': methods, 'faq_cos': {n: d['faq_cos'] for n, d in dense.items()},
                     'faq_keys': faq_keys, 'questions': questions}, fh)

    print(f'\n{"method":28s} | FAQ dev R@1  R@3   MRR  | FAQ test R@1 | SEC dev R@1  R@5  nDCG | SEC test R@5')
    for mname, r in sorted(results.items(), key=lambda kv: -(kv[1]['faq'].get('dev/all', {}).get('R@1', 0)
                                                             + kv[1]['sec'].get('dev/all', {}).get('R@5', 0))):
        fd, ft = r['faq'].get('dev/all', {}), r['faq'].get('test/all', {})
        sd, st = r['sec'].get('dev/all', {}), r['sec'].get('test/all', {})
        print(f'{mname:28s} | {fd.get("R@1", 0):.3f} {fd.get("R@3", 0):.3f} {fd.get("MRR", 0):.3f} | '
              f'{ft.get("R@1", 0):.3f}        | {sd.get("R@1", 0):.3f} {sd.get("R@5", 0):.3f} {sd.get("nDCG", 0):.3f} | '
              f'{st.get("R@5", 0):.3f}')


if __name__ == '__main__':
    main()
