"""Phase 2 - Build the final search index for the server.

1. Export the chosen embedding model to ONNX and quantise it to int8 (what the Node server will run).
2. Embed every section chunk and FAQ unit WITH THAT SAME ONNX MODEL (so stored vectors match live queries).
3. Write data/kb/index/:
     chunks.json, faq_units.json        texts + keys + metadata
     sec.f16, faq.f16                   float16 embeddings, row-major [n x dims]
     meta.json                          model, prefixes, dims, fusion method, BM25 params, matcher thresholds
     model/                             ONNX model (model_quantized.onnx) + tokenizer files

Usage: python build_index.py <model-key> <fusion-method>       e.g. python build_index.py e5-small-ft w0.5:e5-small+bm25
"""
import json
import shutil
import sys

import numpy as np
from common import OUT, WORK
from retrieval import MODELS, load_corpora

INDEX = OUT / 'index'
QUANT = 'avx512_vnni'


def export_onnx(model_key):
    from sentence_transformers import SentenceTransformer, export_dynamic_quantized_onnx_model
    name, _, _ = MODELS[model_key]
    out = INDEX / 'model'
    if out.exists():
        shutil.rmtree(out)
    m = SentenceTransformer(name, backend='onnx', device='cpu')
    m.save(str(out))
    export_dynamic_quantized_onnx_model(m, QUANT, str(out))    # per-channel int8 keeps accuracy closest to fp32
    q = next((out / 'onnx').glob(f'model_*int8_{QUANT}.onnx'))
    q.replace(out / 'onnx' / 'model_quantized.onnx')            # file name transformers.js looks for
    (out / 'onnx' / 'model.onnx').unlink()                      # full-precision copy not needed at runtime
    return out


def main():
    model_key, method = sys.argv[1], sys.argv[2]
    from sentence_transformers import SentenceTransformer
    INDEX.mkdir(parents=True, exist_ok=True)
    model_dir = export_onnx(model_key)
    _, qp, pp = MODELS[model_key]
    m = SentenceTransformer(str(model_dir), backend='onnx', device='cpu',
                            model_kwargs={'file_name': 'onnx/model_quantized.onnx'})
    m.max_seq_length = 512

    sec_chunks, faq_units, _, _ = load_corpora()
    sec = m.encode([pp + c['text'] for c in sec_chunks], batch_size=16, normalize_embeddings=True,
                   show_progress_bar=False).astype(np.float16)
    faq = m.encode([pp + u['text'] for u in faq_units], batch_size=16, normalize_embeddings=True,
                   show_progress_bar=False).astype(np.float16)
    sec.tofile(INDEX / 'sec.f16')
    faq.tofile(INDEX / 'faq.f16')
    (INDEX / 'chunks.json').write_text(json.dumps(sec_chunks, ensure_ascii=False), encoding='utf-8')
    (INDEX / 'faq_units.json').write_text(json.dumps(faq_units, ensure_ascii=False), encoding='utf-8')

    matcher = json.loads((WORK / 'phase2' / 'matcher.json').read_text(encoding='utf-8'))
    meta = {
        'model': model_key, 'source_model': MODELS[model_key][0], 'onnx_file': 'model/onnx/model_quantized.onnx',
        'query_prefix': qp, 'passage_prefix': pp, 'dims': int(sec.shape[1]), 'pooling': 'mean', 'normalize': True,
        'n_chunks': len(sec_chunks), 'n_faq_units': len(faq_units),
        'fusion': method, 'bm25': {'k1': 1.2, 'b': 0.75}, 'low_reliability_weight': 0.85,
        'matcher': {k: matcher[k] for k in ('winner', 'threshold_rule', 'logistic', 'target_precision')},
    }
    (INDEX / 'meta.json').write_text(json.dumps(meta, indent=1), encoding='utf-8')
    size = sum(p.stat().st_size for p in INDEX.rglob('*') if p.is_file()) / 1e6
    print(f'index -> {INDEX}: {len(sec_chunks)} chunks, {len(faq_units)} FAQ units, dims {sec.shape[1]}, {size:.0f} MB total')


if __name__ == '__main__':
    main()
