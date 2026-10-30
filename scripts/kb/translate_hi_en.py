"""Phase 1 - Translate Hindi text to English offline with IndicTrans2 (AI4Bharat, distilled 200M model).

Used for documents that have no English version (the 2021 Panchayat Raj Amendment Gazette).
Output is marked as machine translation pending human review.

Usage: python translate_hi_en.py <doc_key>        (reads kb-work/ocr/<doc_key>.json)
       python translate_hi_en.py --test "<hindi text>"
Output: kb-work/translation/<doc_key>.json and .txt
"""
import json
import re
import sys
import time

import torch
from IndicTransToolkit.processor import IndicProcessor
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from common import WORK

MODEL = 'ai4bharat/indictrans2-indic-en-dist-200M'
SRC, TGT = 'hin_Deva', 'eng_Latn'
BATCH = 8

_model = _tok = _ip = None


def load():
    global _model, _tok, _ip
    if _model is None:
        _tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
        _model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, trust_remote_code=True).eval()
        _ip = IndicProcessor(inference=True)
    return _model, _tok, _ip


MAX_CHARS = 300  # the model truncates at 256 tokens; long legal run-on text is cut at clause boundaries


def split_long(part):
    if len(part) <= MAX_CHARS:
        return [part]
    pieces = re.split(r'(?<=[,;])\s+|\s+(?=\(\d+\)|\([a-z]\)|\([ivx]+\))', part)
    chunks, cur = [], ''
    for piece in pieces:
        if cur and len(cur) + len(piece) + 1 > MAX_CHARS:
            chunks.append(cur)
            cur = piece
        else:
            cur = f'{cur} {piece}'.strip()
    if cur:
        chunks.append(cur)
    out = []
    for c in chunks:  # still too long (no punctuation at all): hard split on word boundaries
        while len(c) > MAX_CHARS:
            cut = c.rfind(' ', 0, MAX_CHARS)
            cut = cut if cut > 50 else MAX_CHARS
            out.append(c[:cut])
            c = c[cut:].strip()
        out.append(c)
    return out


def split_sentences(text):
    text = re.sub(r'\s+', ' ', text)
    parts = re.split(r'(?<=[।?!;:])\s+|(?<=\.)\s+(?=\(|\d)', text)
    return [c.strip() for p in parts if len(p.strip()) > 1 for c in split_long(p.strip()) if len(c.strip()) > 1]


def translate(sentences):
    model, tok, ip = load()
    out = []
    for i in range(0, len(sentences), BATCH):
        batch = ip.preprocess_batch(sentences[i:i + BATCH], src_lang=SRC, tgt_lang=TGT)
        enc = tok(batch, truncation=True, padding='longest', return_tensors='pt', max_length=256)
        with torch.no_grad():
            gen = model.generate(**enc, num_beams=4, max_length=256, use_cache=True)
        dec = tok.batch_decode(gen, skip_special_tokens=True, clean_up_tokenization_spaces=True)
        out += ip.postprocess_batch(dec, lang=TGT)
    return out


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if sys.argv[1] == '--test':
        for s, t in zip(split_sentences(sys.argv[2]), translate(split_sentences(sys.argv[2]))):
            print(f'HI: {s}\nEN: {t}\n')
        return
    key = sys.argv[1]
    data = json.loads((WORK / 'ocr' / f'{key}.json').read_text(encoding='utf-8'))
    started = time.time()
    pages = []
    for page in data['pages']:
        sentences = split_sentences(page['text'])
        english = translate(sentences) if sentences else []
        pages.append({'page': page['page'], 'pairs': [{'hi': h, 'en': e} for h, e in zip(sentences, english)],
                      'text': ' '.join(english)})
        print(f'{key} p{page["page"]}: {len(sentences)} sentences', flush=True)
    out_dir = WORK / 'translation'
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {'doc': key, 'model': MODEL, 'status': 'machine translation - pending human review', 'pages': pages}
    (out_dir / f'{key}.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    (out_dir / f'{key}.txt').write_text('\n\n'.join(f"[[page {p['page']}]]\n{p['text']}" for p in pages), encoding='utf-8')
    print(f'done in {time.time() - started:.0f}s')


if __name__ == '__main__':
    main()
