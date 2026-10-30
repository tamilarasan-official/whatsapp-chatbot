"""Phase 1 - OCR for Hindi PDFs without a usable text layer.

Combined engine:
  Pass 1 (per page, cached):
    1. Tesseract 5 (hin+eng, tessdata_best) reads the full page: keeps layout and matras (vowel signs).
    2. Every word Tesseract is unsure about (low confidence, or a stray Latin word inside Hindi text)
       is re-read by EasyOCR (hi+en) on just that word's crop. Both readings are stored.
  Pass 2 (whole document):
    3. A document-wide vocabulary (words Tesseract read with >= 90% confidence anywhere) acts as a
       simple unigram language model: when the engines disagree, the known word wins.
    4. Normalisation: danda, sub-section numbers, one digit system, Unicode NFC.

Usage: python ocr_hindi.py <doc_key> [first_page] [last_page]
Output: kb-work/ocr/<doc_key>/page-NNN.json (cache), kb-work/ocr/<doc_key>.json and .txt (resolved text)
"""
import json
import re
import sys
import time
import unicodedata

import cv2
import easyocr
import fitz
import numpy as np
import pytesseract
from rapidfuzz.distance import Levenshtein
from common import DOCS, SOURCE, TESSERACT_EXE, WORK

pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
TESS_CONFIG = '--oem 1 --psm 6'
DPI = 300
LOW_CONF = 75
DEVANAGARI = re.compile(r'[ऀ-ॿ]')
LATIN = re.compile(r'[A-Za-z]')
ROMAN_NUMERAL = re.compile(r'^[-(]?[ivxlcIVXL]{1,6}[)]?[.,;:-]*$')
EDGE_NOISE = re.compile(r'^[^ऀ-ॿA-Za-z0-9(]+|[^ऀ-ॿA-Za-z0-9)]+$')


# ---------- Pass 1: OCR one page ----------

def render(page):
    pix = page.get_pixmap(dpi=DPI)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY if pix.n == 3 else cv2.COLOR_RGBA2GRAY)


def tesseract_words(gray):
    data = pytesseract.image_to_data(gray, lang='hin+eng', config=TESS_CONFIG, output_type=pytesseract.Output.DICT)
    words = []
    for i, text in enumerate(data['text']):
        if not text.strip():
            continue
        words.append({
            'text': text, 'conf': float(data['conf'][i]),
            'line': (data['block_num'][i], data['par_num'][i], data['line_num'][i]),
            'box': (data['left'][i], data['top'][i], data['width'][i], data['height'][i]),
        })
    return words


def is_suspicious(word, line_is_hindi):
    t = word['text']
    if ROMAN_NUMERAL.match(t) and not line_is_hindi:
        return False
    if line_is_hindi and LATIN.search(t) and not DEVANAGARI.search(t):
        return True   # stray Latin word inside a Hindi line: usually a Tesseract misread
    return word['conf'] < LOW_CONF and DEVANAGARI.search(t) is not None


def reread_with_easyocr(reader, gray, words):
    """Recognise only the given word boxes (no detection pass): fast and aligned to Tesseract."""
    h, w = gray.shape
    results = []
    for wd in words:
        x, y, bw, bh = wd['box']
        pad = max(4, bh // 4)
        box = [max(0, x - pad), min(w, x + bw + pad), max(0, y - pad), min(h, y + bh + pad)]
        out = reader.recognize(gray, horizontal_list=[box], free_list=[], detail=1)
        results.append((out[0][1], float(out[0][2])) if out else ('', 0.0))
    return results


def ocr_page(reader, page, pno):
    gray = render(page)
    words = tesseract_words(gray)
    lines = {}
    for wd in words:
        lines.setdefault(wd['line'], []).append(wd)

    suspicious = []
    for line_words in lines.values():
        dev = sum(len(DEVANAGARI.findall(wd['text'])) for wd in line_words)
        lat = sum(len(LATIN.findall(wd['text'])) for wd in line_words)
        hindi = dev > lat
        for i, wd in enumerate(line_words):
            wd['hindi_line'] = hindi
            wd['after_chapter'] = i > 0 and line_words[i - 1]['text'].startswith('अध्याय')
        suspicious += [wd for wd in line_words if is_suspicious(wd, hindi) or wd['after_chapter']]

    for wd, (easy_text, easy_conf) in zip(suspicious, reread_with_easyocr(reader, gray, suspicious)):
        wd['easy'] = easy_text.strip()
        wd['easy_conf'] = round(easy_conf * 100)

    keep = ('text', 'conf', 'easy', 'easy_conf', 'hindi_line', 'after_chapter')
    confs = [wd['conf'] for wd in words if wd['conf'] >= 0]
    return {
        'page': pno + 1,
        'lines': [[{k: v for k, v in wd.items() if k in keep} for wd in lw] for lw in lines.values()],
        'words': len(words),
        'mean_conf': round(sum(confs) / len(confs), 1) if confs else 0,
        'reread': len(suspicious),
    }


# ---------- Pass 2: resolve disagreements with a document-wide vocabulary ----------

def clean_token(t):
    return EDGE_NOISE.sub('', t)


def build_vocab(pages):
    vocab = {}
    for page in pages:
        for line in page['lines']:
            for wd in line:
                tok = clean_token(wd['text'])
                if wd['conf'] >= 90 and DEVANAGARI.search(tok):
                    vocab[tok] = vocab.get(tok, 0) + 1
    return vocab


def repair(word, vocab):
    """EasyOCR tends to drop a vowel sign; snap to a known word one edit away (most frequent wins)."""
    tok = clean_token(word)
    if not tok or vocab.get(tok, 0) >= 2 or len(tok) < 3:
        return word
    best, best_n = None, 1
    for cand, n in vocab.items():
        if n > best_n and abs(len(cand) - len(tok)) <= 1 and Levenshtein.distance(cand, tok) == 1:
            best, best_n = cand, n
    return word.replace(tok, best) if best else word


def choose(wd, vocab):
    """Return (text, reason) where reason is None when Tesseract's reading is kept."""
    tess, easy = wd['text'], wd.get('easy')
    if not easy:
        return tess, None
    t_tok, e_tok = clean_token(tess), clean_token(easy)
    if t_tok == e_tok:
        return tess, None
    if wd.get('after_chapter') and ROMAN_NUMERAL.match(easy) and not ROMAN_NUMERAL.match(tess):
        return easy.lstrip('-'), 'chapter-number'
    if wd.get('hindi_line') and LATIN.search(tess) and not DEVANAGARI.search(tess):
        if ROMAN_NUMERAL.match(easy):
            return easy, 'roman-numeral'
        return (repair(easy, vocab), 'latin-misread') if DEVANAGARI.search(easy) else (tess, None)
    if DEVANAGARI.search(tess) and DEVANAGARI.search(easy):
        t_known, e_known = vocab.get(t_tok, 0), vocab.get(e_tok, 0)
        if t_known >= 2 and t_known >= e_known:
            return tess, None
        if e_known >= 2:
            return easy, 'vocabulary'
        if wd.get('easy_conf', 0) >= 85 and wd['conf'] < 50:
            return repair(easy, vocab), 'confidence'
    return tess, None


def normalise(text):
    text = unicodedata.normalize('NFC', text)
    text = text.translate(str.maketrans('०१२३४५६७८९', '0123456789'))  # one digit system
    text = re.sub(r'(?<=[ऀ-ॿ)])\s*\|', '।', text)            # "|" used as danda
    text = re.sub(r'\((?:।|0|l|I)\)', '(1)', text)                      # "(।)", "(0)" -> "(1)"
    text = re.sub(r'(?m)^\(\)', '(i)', text)                             # empty "()" opening a clause
    text = re.sub(r'अध्याय\s*-\s*', 'अध्याय-', text)
    text = re.sub(r'\.{2,}', ' ', text)                                  # dotted leader noise
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def assemble(page, vocab):
    out_lines, decisions = [], []
    for line in page['lines']:
        tokens = []
        for wd in line:
            text, why = choose(wd, vocab)
            if why:
                decisions.append({'tesseract': wd['text'], 'easyocr': wd['easy'], 'used': text, 'why': why})
            tokens.append(text)
        out_lines.append(' '.join(tokens))
    return normalise('\n'.join(out_lines)), decisions


def resolve(key):
    out_dir = WORK / 'ocr' / key
    pages = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(out_dir.glob('page-*.json'))]
    vocab = build_vocab(pages)
    texts, decisions = [], []
    for page in pages:
        text, page_decisions = assemble(page, vocab)
        texts.append({'page': page['page'], 'text': text, 'mean_conf': page['mean_conf']})
        decisions += [dict(d, page=page['page']) for d in page_decisions]
    result = {'doc': key, 'pages': texts, 'decisions': decisions, 'vocab_size': len(vocab)}
    (WORK / 'ocr' / f'{key}.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
    (WORK / 'ocr' / f'{key}.txt').write_text(
        '\n\n'.join(f"[[page {t['page']}]]\n{t['text']}" for t in texts), encoding='utf-8')
    return result


def main():
    key = sys.argv[1]
    doc = fitz.open(SOURCE / DOCS[key]['file'])
    first = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    last = int(sys.argv[3]) if len(sys.argv) > 3 else len(doc)
    out_dir = WORK / 'ocr' / key
    out_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    reader = None
    for pno in range(first - 1, last):
        cache = out_dir / f'page-{pno + 1:03d}.json'
        if cache.exists():
            continue
        reader = reader or easyocr.Reader(['hi', 'en'], gpu=False, verbose=False)
        t = time.time()
        result = ocr_page(reader, doc[pno], pno)
        cache.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        print(f'{key} p{pno + 1}/{len(doc)}: {result["words"]} words, conf {result["mean_conf"]}, '
              f're-read {result["reread"]} ({time.time() - t:.1f}s)', flush=True)

    result = resolve(key)
    print(f'done: {len(result["pages"])} pages, vocabulary {result["vocab_size"]} words, '
          f'{len(result["decisions"])} EasyOCR corrections, {time.time() - started:.0f}s this run')


if __name__ == '__main__':
    main()
