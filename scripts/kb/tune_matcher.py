"""Phase 2 - FAQ matcher: decide when a question IS one of the official FAQs.

Candidate = top FAQ from the chosen retrieval method. Two decision rules, tuned on dev, scored on test:
  A. threshold rule      : accept if cosine(top FAQ) >= tau and margin(top1 - top2) >= delta
  B. logistic regression : P(correct | cosine, margin, BM25 score, char score, query length) >= p
Tuning target: maximise recall subject to precision >= 0.95 (accepting an out-of-scope, Act or case-study
question, or the wrong FAQ, counts as an error).

Usage: python tune_matcher.py <method> <dense-model>    e.g.  python tune_matcher.py w0.5:e5-small+bm25 e5-small
Output: kb-work/phase2/matcher.json
"""
import json
import math
import pickle
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from common import WORK

TARGET_PRECISION = 0.95


def features(qi, q, rk_method, cos, faq_keys, bm25, char):
    ranking = rk_method['faq'][qi]
    top = ranking[0][0]
    per_faq = {}
    for u, key in enumerate(faq_keys):
        per_faq[key] = max(per_faq.get(key, -1), float(cos[u, qi]))
    s1 = per_faq[top]
    s2 = max(v for k, v in per_faq.items() if k != top)
    b = dict(bm25['faq'][qi]).get(top, 0.0)
    c = dict(char['faq'][qi]).get(top, 0.0)
    return top, [s1, s1 - s2, math.log1p(b), c, len(q['text'].split())]


def label(q, top):
    return int(q['type'] == 'faq' and top in q['gold_faq'])


def evaluate(accept, rows):
    acc = [r for r, a in zip(rows, accept) if a]
    correct = sum(r['label'] for r in acc)
    n_faq = sum(1 for r in rows if r['type'] == 'faq')
    oos = [a for r, a in zip(rows, accept) if r['type'] == 'oos']
    other = [a for r, a in zip(rows, accept) if r['type'] in ('act', 'case')]
    return {'accepted': len(acc), 'precision': round(correct / len(acc), 3) if acc else 1.0,
            'recall': round(correct / n_faq, 3) if n_faq else 0.0,
            'oos_false_accept': round(sum(oos) / len(oos), 3) if oos else 0.0,
            'act_case_accept': round(sum(other) / len(other), 3) if other else 0.0}


def main():
    method, dense_name = sys.argv[1], sys.argv[2]
    data = pickle.load(open(WORK / 'phase2' / 'rankings.pkl', 'rb'))
    qs, methods = data['questions'], data['methods']
    cos = data['faq_cos'][dense_name]
    rows = []
    for i, q in enumerate(qs):
        top, x = features(i, q, methods[method], cos, data['faq_keys'], methods['bm25'], methods['char'])
        rows.append({'id': q['id'], 'type': q['type'], 'split': q['split'], 'lang': q['lang'], 'top': top,
                     'x': x, 'label': label(q, top)})
    dev = [r for r in rows if r['split'] == 'dev']
    test = [r for r in rows if r['split'] == 'test']

    # A. threshold rule (grid search on dev)
    best = None
    for tau in np.arange(0.30, 0.97, 0.0025):
        for delta in (0.0, 0.005, 0.01, 0.02, 0.03, 0.05):
            m = evaluate([r['x'][0] >= tau and r['x'][1] >= delta for r in dev], dev)
            if m['precision'] >= TARGET_PRECISION and (best is None or m['recall'] > best[2]['recall']):
                best = (round(float(tau), 4), delta, m)
    tau, delta, dev_a = best
    test_a = evaluate([r['x'][0] >= tau and r['x'][1] >= delta for r in test], test)

    # B. logistic regression (trained on dev only)
    X = np.array([r['x'] for r in dev])
    y = np.array([r['label'] for r in dev])
    mu, sd = X.mean(0), X.std(0) + 1e-9
    clf = LogisticRegression(C=1.0, class_weight='balanced', max_iter=2000).fit((X - mu) / sd, y)
    p_dev = clf.predict_proba((X - mu) / sd)[:, 1]
    best_p = None
    for p in np.arange(0.30, 0.99, 0.01):
        m = evaluate(list(p_dev >= p), dev)
        if m['precision'] >= TARGET_PRECISION and (best_p is None or m['recall'] > best_p[1]['recall']):
            best_p = (round(float(p), 2), m)
    p_thr, dev_b = best_p
    p_test = clf.predict_proba((np.array([r['x'] for r in test]) - mu) / sd)[:, 1]
    test_b = evaluate(list(p_test >= p_thr), test)

    winner = 'logistic' if test_b['recall'] > test_a['recall'] and test_b['precision'] >= test_a['precision'] - 0.02 \
        else 'threshold'
    result = {
        'method': method, 'dense_model': dense_name, 'target_precision': TARGET_PRECISION, 'winner': winner,
        'threshold_rule': {'tau': tau, 'delta': delta, 'dev': dev_a, 'test': test_a},
        'logistic': {'p': p_thr, 'dev': dev_b, 'test': test_b,
                     'features': ['cosine', 'margin', 'log1p_bm25', 'char_tfidf', 'query_words'],
                     'coef': clf.coef_[0].round(4).tolist(), 'intercept': round(float(clf.intercept_[0]), 4),
                     'mean': mu.round(5).tolist(), 'std': sd.round(5).tolist()},
        'errors_test': [{'id': r['id'], 'type': r['type'], 'lang': r['lang'], 'top': r['top'],
                         'cos': round(r['x'][0], 3)} for r in test
                        if (r['x'][0] >= tau and r['x'][1] >= delta) and not r['label']],
    }
    (WORK / 'phase2' / 'matcher.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('method', 'dense_model', 'winner')}))
    print('A threshold rule  tau=%.4f delta=%.3f' % (tau, delta), '| dev', dev_a, '\n                   test', test_a)
    print('B logistic        p=%.2f' % p_thr, '| dev', dev_b, '\n                   test', test_b)
    print('wrong accepts on test (threshold rule):', result['errors_test'])


if __name__ == '__main__':
    main()
