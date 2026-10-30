"""Phase 2 - Does a cross-encoder re-ranker (BAAI/bge-reranker-v2-m3) improve the chosen hybrid?

Re-scores the top-10 FAQ candidates and top-20 section candidates of <method>, then:
  - retrieval metrics after re-ranking (same metrics as eval_retrieval.py)
  - FAQ matcher using the re-ranker probability as the confidence (threshold tuned on dev, precision >= 0.95)
  - latency per question on CPU

Usage: python rerank_eval.py <method> <dense-model>
Output: kb-work/phase2/rerank.json
"""
import json
import pickle
import sys
import time

import numpy as np
from common import WORK
from eval_retrieval import breakdown
from retrieval import DEVANAGARI, embed_corpus, embed_queries, load_corpora
from tune_matcher import TARGET_PRECISION, evaluate

TOP_FAQ, TOP_SEC = 10, 20


def main():
    from sentence_transformers import CrossEncoder
    method, dense_name = sys.argv[1], sys.argv[2]
    test_only = len(sys.argv) > 3 and sys.argv[3] == 'test'   # CPU is slow: score the held-out split only
    data = pickle.load(open(WORK / 'phase2' / 'rankings.pkl', 'rb'))
    qs, m = data['questions'], data['methods'][method]
    sec_chunks, _, faqs, _ = load_corpora()
    faq_by_id = {f['id']: f for f in faqs}

    # best chunk per section key for each question (dense score), to give the re-ranker real passage text
    S = embed_corpus(dense_name, [c['text'] for c in sec_chunks], 'sec')
    Q = embed_queries(dense_name, [q['text'] for q in qs])
    keys = np.array([c['key'] for c in sec_chunks])

    ce = CrossEncoder('BAAI/bge-reranker-v2-m3', max_length=512, device='cpu')
    new_faq, new_sec, timing = {}, {}, []
    for i, q in enumerate(qs):
        if test_only and q['split'] != 'test':
            continue
        hindi = bool(DEVANAGARI.search(q['text']))
        t = time.time()
        fc = [k for k, _ in m['faq'][i][:TOP_FAQ]]
        ftexts = [(faq_by_id[k]['q_hi'] + '\n' + faq_by_id[k]['a_hi']) if hindi else
                  (faq_by_id[k]['q_en'] + '\n' + faq_by_id[k]['a_en']) for k in fc]
        fs = ce.predict([(q['text'], x[:1500]) for x in ftexts], batch_size=16, show_progress_bar=False)
        new_faq[q['id']] = sorted(zip(fc, map(float, fs)), key=lambda kv: -kv[1])
        if q['type'] in ('act', 'case'):
            sc = [k for k, _ in m['sec'][i][:TOP_SEC]]
            scores = S @ Q[i]
            texts = []
            for k in sc:
                idx = np.where(keys == k)[0]
                texts.append(sec_chunks[idx[np.argmax(scores[idx])]]['text'][:1800])
            ss = ce.predict([(q['text'], x) for x in texts], batch_size=16, show_progress_bar=False)
            new_sec[q['id']] = sorted(zip(sc, map(float, ss)), key=lambda kv: -kv[1])
        timing.append(time.time() - t)
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(qs)} questions', flush=True)

    scored = [q for q in qs if q['id'] in new_faq]
    faq_metrics = breakdown(scored, new_faq, 'faq')
    sec_metrics = breakdown(scored, {**{q['id']: [] for q in scored}, **new_sec}, 'sec')

    # matcher on re-ranker probability
    rows = []
    for q in scored:
        top, p = new_faq[q['id']][0]
        rows.append({'type': q['type'], 'split': q['split'], 'p': p,
                     'label': int(q['type'] == 'faq' and top in q['gold_faq'])})
    dev = [r for r in rows if r['split'] == 'dev']
    test = [r for r in rows if r['split'] == 'test']
    best = None
    for thr in np.arange(0.05, 0.995, 0.005):
        mm = evaluate([r['p'] >= thr for r in dev], dev) if dev else None
        if mm and mm['precision'] >= TARGET_PRECISION and (best is None or mm['recall'] > best[1]['recall']):
            best = (round(float(thr), 3), mm)
    thr, dev_m = best if best else (0.5, None)   # test-only run: fixed 0.5 probability threshold
    test_m = evaluate([r['p'] >= thr for r in test], test)

    out = {'method': method, 'reranker': 'BAAI/bge-reranker-v2-m3', 'faq': faq_metrics, 'sec': sec_metrics,
           'matcher': {'threshold': thr, 'dev': dev_m, 'test': test_m},
           'latency_ms': {'mean': round(1000 * float(np.mean(timing))), 'p90': round(1000 * float(np.percentile(timing, 90)))}}
    (WORK / 'phase2' / 'rerank.json').write_text(json.dumps(out, indent=1, default=float), encoding='utf-8')
    for task in ('faq', 'sec'):
        for k in ('dev/all', 'test/all'):
            print(task, k, out[task].get(k))
    print('matcher', out['matcher'])
    print('latency', out['latency_ms'])


if __name__ == '__main__':
    main()
