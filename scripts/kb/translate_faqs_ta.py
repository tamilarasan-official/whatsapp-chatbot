"""Translate the 68 official FAQs from English to Tamil offline with IndicTrans2 (AI4Bharat en-indic, 200M).

Line by line, so bullet structure ("• ", "o ") is kept. Output is machine translation pending human review.
Needs Hugging Face access to the gated model ai4bharat/indictrans2-en-indic-dist-200M (`hf auth login`).

Usage:  python translate_faqs_ta.py          translate (cached in data/kb/faqs_ta.json) and merge
        python translate_faqs_ta.py --merge  only merge an existing data/kb/faqs_ta.json
Writes: data/kb/faqs_ta.json {id: {q_ta, a_ta}}; adds q_ta / a_ta to data/kb/faqs.json and data/faqs.json.
"""
import json
import re
import sys

from common import OUT, ROOT

MODEL = 'ai4bharat/indictrans2-en-indic-dist-200M'
SRC, TGT = 'eng_Latn', 'tam_Taml'
BATCH = 8
CACHE = OUT / 'faqs_ta.json'
BULLET = re.compile(r'^(\s*(?:•|o|-|\d+[.)])\s+)')


def translator():
    import torch
    from IndicTransToolkit.processor import IndicProcessor
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, trust_remote_code=True).eval()
    ip = IndicProcessor(inference=True)

    def run(sentences):
        out = []
        for i in range(0, len(sentences), BATCH):
            batch = ip.preprocess_batch(sentences[i:i + BATCH], src_lang=SRC, tgt_lang=TGT)
            enc = tok(batch, truncation=True, padding='longest', return_tensors='pt', max_length=256)
            with torch.no_grad():
                # use_cache=False: the installed transformers version breaks IndicTrans2's cache
                gen = model.generate(**enc, num_beams=4, max_length=256, use_cache=False)
            out += ip.postprocess_batch(tok.batch_decode(gen, skip_special_tokens=True), lang=TGT)
        return out
    return run


def translate_text(run, text):
    """Translate each non-empty line, keeping its bullet prefix."""
    lines = text.split('\n')
    todo = [(i, BULLET.match(l).group(1) if BULLET.match(l) else '', BULLET.sub('', l).strip())
            for i, l in enumerate(lines) if l.strip()]
    done = run([body for _, _, body in todo]) if todo else []
    for (i, prefix, _), ta in zip(todo, done):
        lines[i] = prefix + ta
    return '\n'.join(lines)


def merge(cache):
    for path in (OUT / 'faqs.json', ROOT / 'data' / 'faqs.json'):
        faqs = json.loads(path.read_text(encoding='utf-8'))
        for f in faqs:
            if f['id'] in cache:
                f.update(cache[f['id']])
        path.write_text(json.dumps(faqs, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'merged {sum(f["id"] in cache for f in faqs)} Tamil FAQs into {path}')


def main():
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    if '--merge' not in sys.argv:
        faqs = json.loads((OUT / 'faqs.json').read_text(encoding='utf-8'))
        run = translator()
        for n, f in enumerate(faqs, 1):
            if f['id'] in cache:
                continue
            cache[f['id']] = {'q_ta': translate_text(run, f['q_en']), 'a_ta': translate_text(run, f['a_en']),
                              'ta_source': 'IndicTrans2 machine translation from English, pending review'}
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
            print(f'{n}/{len(faqs)} {f["id"]}', flush=True)
    merge(cache)


if __name__ == '__main__':
    main()
