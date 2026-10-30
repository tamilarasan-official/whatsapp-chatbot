"""Phase 1 - eVoting case study: chapters from the text layer + text read from posters/screenshots.

- Chapters: split at the headings listed in the document's own table of contents (page 2).
- Images (app screenshots in Annexures 1-2, Hindi awareness posters in Annexure 3): every embedded image
  is read with the combined Tesseract + EasyOCR engine (ocr_hindi.py); images that yield real text become
  knowledge entries marked "image OCR"; photos without text are dropped.

Usage: python extract_case_study.py
Output: merged into data/kb/sections.json (doc = evoting_case_study_en); OCR cache in kb-work/ocr/evoting_case_study_en/
"""
import json
import re
import sys
import unicodedata

import cv2
import easyocr
import fitz
import numpy as np
from common import DOCS, OUT, SOURCE, WORK
from ocr_hindi import DEVANAGARI, assemble, build_vocab, ocr_gray

KEY = 'evoting_case_study_en'
META = DOCS[KEY]
MIN_IMAGE_SIDE = 250      # skip icons and logos
MIN_TEXT_CHARS = 60       # an image needs this much readable text to become an entry
MIN_CONF = 55             # mean Tesseract confidence for a usable image
TOC_LINE = re.compile(r'^\s*([A-Z0-9][A-Z0-9 &–\-,.()\'’]+?)\s*\.{3,}\s*(\d+)\s*$')


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:60]


def toc_headings(doc):
    heads = []
    for ln in doc[1].get_text().splitlines():
        m = TOC_LINE.match(ln)
        if m:
            heads.append(re.sub(r'\s+', ' ', m.group(1)).strip())
    return heads


def heading_key(s):
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def chapters(doc):
    """Cut the text layer at lines matching a table-of-contents heading (headings may wrap onto two lines)."""
    heads = toc_headings(doc)
    keys = {heading_key(h): h for h in heads}
    out, current = [], None
    for pno in range(2, len(doc)):
        lines = [ln.strip() for ln in doc[pno].get_text().splitlines() if ln.strip()]
        i = 0
        while i < len(lines):
            one = heading_key(lines[i])
            two = heading_key(lines[i] + ' ' + lines[i + 1]) if i + 1 < len(lines) else ''
            hit = keys.get(two) or keys.get(one)
            if hit and lines[i].isupper():
                current = {'title': hit.title() if hit.isupper() else hit, 'page': pno + 1, 'lines': []}
                out.append(current)
                i += 2 if keys.get(two) else 1
                continue
            if current is not None and not re.fullmatch(r'\d{1,2}', lines[i]):
                current['lines'].append(lines[i])
            i += 1
    for c in out:
        c['text'] = unicodedata.normalize('NFC', re.sub(r'[ \t]+', ' ', '\n'.join(c.pop('lines'))).strip())
    return heads, out


def image_entries(doc):
    """OCR every sizeable embedded image (cached per image) and keep the ones with real text."""
    cache_dir = WORK / 'ocr' / KEY
    cache_dir.mkdir(parents=True, exist_ok=True)
    reader, results = None, []
    for pno in range(len(doc)):
        for idx, info in enumerate(doc[pno].get_images(full=True)):
            cache = cache_dir / f'p{pno + 1:02d}-img{idx + 1}.json'
            if cache.exists():
                results.append(json.loads(cache.read_text(encoding='utf-8')))
                continue
            raw = doc.extract_image(info[0])
            img = cv2.imdecode(np.frombuffer(raw['image'], np.uint8), cv2.IMREAD_GRAYSCALE)
            if img is None or min(img.shape) < MIN_IMAGE_SIDE:
                continue
            if max(img.shape) < 1400:  # upscale small images so text is ~30px high for Tesseract
                scale = 1400 / max(img.shape)
                img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            reader = reader or easyocr.Reader(['hi', 'en'], gpu=False, verbose=False)
            res = dict(ocr_gray(reader, img, psm=3), page=pno + 1, image=idx + 1)
            cache.write_text(json.dumps(res, ensure_ascii=False), encoding='utf-8')
            print(f'  image p{pno + 1}#{idx + 1}: {res["words"]} words, conf {res["mean_conf"]}', flush=True)
            results.append(res)
    return results


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    doc = fitz.open(SOURCE / META['file'])
    heads, chaps = chapters(doc)
    print(f'table of contents: {len(heads)} headings; chapters found: {len(chaps)}')

    sections = [{'id': f'{KEY}:{slug(c["title"])}', 'doc': KEY, 'act': META['title'], 'lang': 'en', 'chapter': '',
                 'section': c['title'], 'title': c['title'], 'page': c['page'], 'text': c['text'], 'source': 'text',
                 'reliability': 'high'}
                for c in chaps if len(c['text']) >= 40]

    images = image_entries(doc)
    # Vocabulary for resolving OCR disagreements: this document's images + the large Hindi Act vocabulary
    act_ocr = WORK / 'ocr' / 'panchayat_act_hi'
    act_pages = [json.loads(p.read_text(encoding='utf-8')) for p in sorted(act_ocr.glob('page-*.json'))]
    vocab = build_vocab(images + act_pages)
    kept = 0
    for res in images:
        text, _ = assemble(res, vocab)
        readable = len(re.findall(r'[ऀ-ॿA-Za-z0-9]', text))
        if readable < MIN_TEXT_CHARS or res['mean_conf'] < MIN_CONF:
            continue
        kept += 1
        lang = 'hi' if len(DEVANAGARI.findall(text)) > readable / 2 else 'en'
        annex = 'Annexure 3 - awareness poster' if res['page'] >= 35 else 'Annexures 1-2 - app screenshot'
        sections.append({'id': f'{KEY}:img-p{res["page"]}-{res["image"]}', 'doc': KEY, 'act': META['title'],
                         'lang': lang, 'chapter': annex, 'section': f'Image p{res["page"]}#{res["image"]}',
                         'title': f'{annex} (page {res["page"]})', 'page': res['page'], 'text': text,
                         'source': 'image OCR',
                         # Multi-column newspaper clippings interleave columns; never cite numbers from them.
                         'reliability': 'low' if res['words'] > 150 or res['mean_conf'] < 70 else 'medium'})
    print(f'images: {len(images)} read, {kept} with usable text kept')

    path = OUT / 'sections.json'
    existing = json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    merged = [s for s in existing if s['doc'] != KEY] + sections
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{KEY}: {len(sections)} entries ({len(chaps)} chapters + {kept} images) -> {path} (total {len(merged)})')


if __name__ == '__main__':
    main()
