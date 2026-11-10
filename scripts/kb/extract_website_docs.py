"""Phase 1 - Official documents from the Commission's website (sec.bihar.gov.in) into sections.

The Acts and FAQs do not hold the election rules, forms, candidate handbooks or the model code of
conduct; the website does. Each listed PDF is downloaded once (kb-source/web/, git-ignored) and read
page by page:
  text layer (Unicode)                   -> as is                       reliability high
  DevLys / Kruti Dev legacy Hindi font   -> devlys_convert.page_text    reliability high
  scanned, or another legacy font        -> Tesseract OCR (hin+eng)     reliability medium
Pages are cached in kb-work/web/<slug>/; each page becomes one section with its URL and page number.

Usage: python extract_website_docs.py [slug ...]      (default: all)
Then:  python update_index.py
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ProcessPoolExecutor

import fitz
from common import OUT, SOURCE, TESSERACT_EXE, WORK

SITE = 'https://sec.bihar.gov.in/'
USER_AGENT = 'Mozilla/5.0 (SEC Bihar helpdesk demo indexer)'
# slug, title, path on the site. Chosen for voter / candidate questions (rules, nomination, conduct, apps);
# officials' manuals, results, tenders and dated notices are left to the live website search.
DOCS = [
    ('panchayat_election_rules_2006', 'Bihar Panchayat Election Rules, 2006 (English)',
     'Documents/Panchayat_Act_Rule/RULE_Bihar Panchayat Election Rules 2006 -( English).pdf'),
    ('panchayat_election_amendment_rules_2016', 'Bihar Panchayat Election (Amendment) Rules, 2016',
     'Documents/Panchayat_Act_Rule/RULE_Bihar Panchayat Election (Amendment) Rules 2016-1.pdf'),
    ('municipal_election_rules_2007', 'Bihar Municipal Election Rules, 2007', 'old-sec/download/N_Rules, 2007.pdf'),
    ('municipal_rules_1081', 'Bihar Municipal Election Rules (notification 1081)',
     'Documents/Instruction_Letters/Bihar_Municipal_Rule_1081.pdf'),
    ('handbook_candidate', 'Handbook of Candidate', 'Documents/Manual/Handbook of Candidate.pdf'),
    ('nomination_instructions', 'Nomination Instructions', 'Documents/Manual/Nomination Instructions.pdf'),
    ('nomination_form', 'Nomination Form (Panchayat)', 'Documents/Instruction_Letters/Nomination_Form.pdf'),
    ('nomination_municipal', 'Nomination papers and instructions (Municipal)', 'Documents/Instruction_Letters/Nomination_NGR.pdf'),
    ('candidate_book', 'Candidate Booklet', 'Documents/Instruction_Letters/Candidate_Book.pdf'),
    ('candidate_instructions_3853', 'Instructions for candidates (letter 3853, 14.09.2022)',
     'Documents/Notice/Candidates_Instructions_3853 dt.14.09.22.pdf'),
    ('model_code_3742', 'Model Code of Conduct (letter 3742, 08.09.2022)', 'Documents/Notice/3742 dt.08.09.22- MCC.pdf'),
    ('model_code_municipal_2022', 'Model Code of Conduct, Municipal Elections 2022',
     'Documents/Instruction_Letters/Adarsh Achar Sahita NGR 2022.pdf'),
    ('led_van_permission', 'LED van and bike campaign permission (letter 4668, 03.10.2022)',
     'Documents/Instruction_Letters/4668 dt. 03.10.2022, LED Van and Bike Permission.pdf'),
    ('suvidha', 'Suvidha: campaign permissions', 'Documents/Instruction_Letters/Suvidha.pdf'),
    ('candidate_suvidha_manual', 'Candidate Suvidha user manual (online)', 'Documents/Manual/Candidate Suvidha Pan Bye 2023 Online.pdf'),
    ('matdata_suvidha_manual', 'Matdata Suvidha app user manual', 'Documents/Manual/Matdata_Suvidha_Manual.pdf'),
    ('samadhan_manual', 'Samadhan (complaints) user manual', 'Documents/Manual/Samadhan_Manual_Public.pdf'),
    ('online_nomination_manual', 'Online nomination user manual', 'Documents/OnlineNominationUserManual.pdf'),
    ('election_symbols', 'Election symbols', 'Documents/Manual/Election Symbol.pdf'),
    ('ward_formation_faq', 'FAQ on ward formation', 'Documents/Instruction_Letters/FAQ on Call Center Regarding Ward Formation.pdf'),
]
DOWNLOADS = SOURCE / 'web'
CACHE = WORK / 'web'
CONVERTIBLE = ('devlys', 'krutidev', 'kruti dev', 'krishna')  # devlys_convert maps these fonts
OTHER_LEGACY = ('akruti', 'bhartiya', 'shusha', 'walkman')    # no mapping: OCR the rendered page
MIN_CHARS = 60
DPI = 300
DEVANAGARI = re.compile('[ऀ-ॿ]')


def url_of(path):
    return SITE + urllib.parse.quote(path)


def download(slug, path):
    out = DOWNLOADS / f'{slug}.pdf'
    if out.exists():
        try:
            if len(fitz.open(out)):
                return out
        except Exception:
            pass  # truncated earlier: fetch again
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url_of(path), headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=900) as res, open(out, 'wb') as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)
    time.sleep(1)  # be gentle with the server
    return out


def fonts_of(page):
    return {s['font'].lower() for b in page.get_text('dict')['blocks'] for ln in b.get('lines', []) for s in ln['spans']}


def ocr(page):
    import cv2
    import numpy as np
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_EXE
    pix = page.get_pixmap(dpi=DPI)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY if pix.n == 3 else cv2.COLOR_RGBA2GRAY)
    return pytesseract.image_to_string(gray, lang='hin+eng', config='--oem 1 --psm 6')  # models: TESSDATA_PREFIX (common.py)


def read_page(args):
    """One page -> {page, text, method}. Runs in a worker process; cached on disk."""
    pdf, pno, cache_dir = args
    cached = cache_dir / f'page-{pno + 1:03d}.json'
    if cached.exists():
        return json.loads(cached.read_text(encoding='utf-8'))
    page = fitz.open(pdf)[pno]
    fonts = fonts_of(page)
    text, method = page.get_text(), 'text'
    if any(f in font for font in fonts for f in CONVERTIBLE) and not any(f in font for font in fonts for f in OTHER_LEGACY):
        from devlys_convert import page_text
        text, method = page_text(page, {'corrupt_spans': 0}), 'font conversion'
    if len(re.sub(r'\s', '', text)) < MIN_CHARS or any(f in font for font in fonts for f in OTHER_LEGACY):
        text, method = ocr(page), 'OCR'
    out = {'page': pno + 1, 'method': method, 'text': unicodedata.normalize('NFC', text)}
    cached.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    return out


def clean(text):
    lines = [re.sub(r'[ \t]+', ' ', ln).strip() for ln in text.splitlines()]
    return '\n'.join(ln for ln in lines if ln and not re.fullmatch(r'[-–—.\d\s|]{1,8}', ln))


def sections_for(slug, title, path, pool):
    pdf = download(slug, path)
    cache_dir = CACHE / slug
    cache_dir.mkdir(parents=True, exist_ok=True)
    n = len(fitz.open(pdf))
    pages = list(pool.map(read_page, [(pdf, i, cache_dir) for i in range(n)]))
    out = []
    for p in pages:
        text = clean(p['text'])
        if len(text) < MIN_CHARS:
            continue
        lang = 'hi' if len(DEVANAGARI.findall(text)) > 0.3 * len(re.findall(r'\w', text)) else 'en'
        out.append({'id': f'web_{slug}:p{p["page"]}', 'doc': f'web_{slug}', 'act': title, 'lang': lang, 'chapter': '',
                    'section': str(p['page']), 'title': f'{title}, page {p["page"]}', 'page': p['page'], 'text': text,
                    'url': url_of(path), 'source': p['method'],
                    'reliability': 'medium' if p['method'] == 'OCR' else 'high'})
    methods = {m: sum(1 for p in pages if p['method'] == m) for m in ('text', 'font conversion', 'OCR')}
    print(f'{slug}: {n} pages, {len(out)} kept, {methods}', flush=True)
    return out


def main():
    only = set(sys.argv[1:])
    path = OUT / 'sections.json'
    sections = json.loads(path.read_text(encoding='utf-8'))
    with ProcessPoolExecutor() as pool:
        for slug, title, site_path in DOCS:
            if only and slug not in only:
                continue
            try:
                new = sections_for(slug, title, site_path, pool)
            except Exception as err:  # one bad download must not stop the rest
                print(f'{slug}: FAILED {err}', flush=True)
                continue
            sections = [s for s in sections if s['doc'] != f'web_{slug}'] + new
            path.write_text(json.dumps(sections, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'total {len(sections)} sections -> {path}')


if __name__ == '__main__':
    main()
