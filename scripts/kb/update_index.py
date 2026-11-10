"""Phase 2 - Add new or changed sections to the server index without re-exporting the model.

build_index.py re-exports the ONNX model; the deployed model is fetched by checksum (Dockerfile), so a new
document is embedded with the model already in data/kb/index/model instead. Unchanged chunks keep their
stored vectors. A sample of them is re-embedded first as a guard: the stored vectors were made with an
earlier build of the same model and agree at cosine ~0.97-0.99 (measured 2026-11-10), so anything far
lower means a different model.

Usage: python update_index.py
"""
import json

import numpy as np
from common import OUT
from retrieval import load_corpora

INDEX = OUT / 'index'
SAMPLE = 20
TOLERANCE = 0.95  # lowest cosine between a stored vector and the same text embedded again


def main():
    from sentence_transformers import SentenceTransformer
    meta = json.loads((INDEX / 'meta.json').read_text(encoding='utf-8'))
    m = SentenceTransformer(str(INDEX / 'model'), backend='onnx', device='cpu',
                            model_kwargs={'file_name': 'onnx/model_quantized.onnx'})
    m.max_seq_length = 512
    pp, dims = meta['passage_prefix'], meta['dims']
    encode = lambda texts: m.encode([pp + t for t in texts], batch_size=16, normalize_embeddings=True,
                                    show_progress_bar=False).astype(np.float32)

    old_chunks = json.loads((INDEX / 'chunks.json').read_text(encoding='utf-8'))
    old_vecs = np.fromfile(INDEX / 'sec.f16', dtype=np.float16).reshape(-1, dims).astype(np.float32)
    stored = {(c['id'], c['text']): old_vecs[i] for i, c in enumerate(old_chunks)}

    step = max(1, len(old_chunks) // SAMPLE)
    sample = old_chunks[::step][:SAMPLE]
    sims = (encode([c['text'] for c in sample]) * np.stack([stored[(c['id'], c['text'])] for c in sample])).sum(1)
    assert sims.min() >= TOLERANCE, f'model differs from the one that built the index (min cosine {sims.min():.4f})'

    sec_chunks, faq_units, _, _ = load_corpora()
    new = [c for c in sec_chunks if (c['id'], c['text']) not in stored]
    fresh = dict(zip(((c['id'], c['text']) for c in new), encode([c['text'] for c in new]))) if new else {}
    vecs = np.stack([stored.get((c['id'], c['text']), fresh.get((c['id'], c['text']))) for c in sec_chunks])

    vecs.astype(np.float16).tofile(INDEX / 'sec.f16')
    (INDEX / 'chunks.json').write_text(json.dumps(sec_chunks, ensure_ascii=False), encoding='utf-8')
    meta['n_chunks'] = len(sec_chunks)
    (INDEX / 'meta.json').write_text(json.dumps(meta, indent=1), encoding='utf-8')
    assert len(faq_units) == meta['n_faq_units'], 'FAQs changed: rebuild faq.f16 with build_index.py'
    print(f'model check: min cosine {sims.min():.4f} over {len(sample)} stored chunks')
    print(f'index: {len(sec_chunks)} chunks ({len(new)} new, {len(old_chunks) + len(new) - len(sec_chunks)} removed)')


if __name__ == '__main__':
    main()
