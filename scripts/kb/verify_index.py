"""Phase 2 - Verify the built index exactly as the server will use it (int8 ONNX model + float16 vectors).

Usage: python verify_index.py
"""
import json
import time

import numpy as np
from common import OUT
from eval_retrieval import breakdown
from retrieval import aggregate

INDEX = OUT / 'index'


def main():
    from sentence_transformers import SentenceTransformer
    meta = json.loads((INDEX / 'meta.json').read_text(encoding='utf-8'))
    chunks = json.loads((INDEX / 'chunks.json').read_text(encoding='utf-8'))
    units = json.loads((INDEX / 'faq_units.json').read_text(encoding='utf-8'))
    d = meta['dims']
    S = np.fromfile(INDEX / 'sec.f16', dtype=np.float16).reshape(-1, d).astype(np.float32)
    F = np.fromfile(INDEX / 'faq.f16', dtype=np.float16).reshape(-1, d).astype(np.float32)
    m = SentenceTransformer(str(INDEX / 'model'), backend='onnx', device='cpu',
                            model_kwargs={'file_name': 'onnx/model_quantized.onnx'})
    qs = json.loads((OUT / 'eval' / 'questions.json').read_text(encoding='utf-8'))
    t = time.time()
    Q = m.encode([meta['query_prefix'] + q['text'] for q in qs], normalize_embeddings=True, batch_size=1)
    ms = (time.time() - t) / len(qs) * 1000
    w = np.array([meta['low_reliability_weight'] if c['reliability'] == 'low' else 1.0 for c in chunks])
    sec = {q['id']: aggregate(S @ Q[i], [c['key'] for c in chunks], w) for i, q in enumerate(qs)}
    faq = {q['id']: aggregate(F @ Q[i], [u['key'] for u in units]) for i, q in enumerate(qs)}
    fm, sm = breakdown(qs, faq, 'faq'), breakdown(qs, sec, 'sec')

    tau = meta['matcher']['threshold_rule']['tau']
    test = [q for q in qs if q['split'] == 'test']
    acc = [(q, faq[q['id']][0]) for q in test if faq[q['id']][0][1] >= tau]
    correct = sum(1 for q, (k, _) in acc if q['type'] == 'faq' and k in q['gold_faq'])
    n_faq = sum(1 for q in test if q['type'] == 'faq')
    oos_fa = sum(1 for q, _ in acc if q['type'] == 'oos')
    print(f'query encoding (int8 ONNX, CPU, one at a time): {ms:.1f} ms')
    print('FAQ  test:', fm['test/all'], '| en', fm['test/en']['R@1'], 'hi', fm['test/hi']['R@1'], 'hl', fm['test/hl']['R@1'])
    print('SEC  test:', sm['test/all'], '| all R@5', sm['all/all']['R@5'])
    print(f'matcher tau={tau}: accepted {len(acc)}, precision {correct / max(len(acc), 1):.3f}, '
          f'recall {correct / n_faq:.3f}, out-of-scope accepted {oos_fa}')
    out = {'query_ms': round(ms, 1), 'faq': fm, 'sec': sm,
           'matcher_test': {'precision': round(correct / max(len(acc), 1), 3), 'recall': round(correct / n_faq, 3),
                            'oos_accepted': oos_fa}}
    (OUT / 'eval' / 'index_verification.json').write_text(json.dumps(out, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
