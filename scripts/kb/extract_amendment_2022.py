"""Phase 1 - Bihar Municipal (Amendment) Act, 2022 (Bihar Gazette 176, 2 April 2022) into sections.

The gazette holds the Hindi text (DevLys font, pages 1-4; run devlys_convert.py municipal_amendment_2022_hi
first) and the English text (pages 4-8). Each amendment section changes one section of the Bihar Municipal
Act, 2007; that section number is stored in `amends` so the server can show the new law next to the old text.

Usage: python extract_amendment_2022.py
Output: merged into data/kb/sections.json
"""
import json
import re
import unicodedata

import fitz
from common import DOCS, OUT, SOURCE, WORK

# Gazette page headers ("5ॢ", "बहर गजट", "[सधरण& 2 [", "ल 2022") are in an unreadable font. In the English
# text every line with Devanagari is one; in the Hindi text they are matched by pattern.
HEADER = re.compile(r'^\s*(\d{1,2}\W?|\W|.*गजट.*|.*सधरण.*|ल 2022|\[ध¡क.*|Website:.*)\s*$')
DEVANAGARI = re.compile('[ऀ-ॿ]')
LANGS = {
    'municipal_amendment_2022_en': {
        'start': 'THE BIHAR MUNICIPAL (AMENDMENT) ACT, 2022', 'end': 'Jyoti Swaroop Srivastava',
        'head': re.compile(r'^(\d{1,2})\.\s+(Short title, extent and commencement|Amendment of Section-(\d+) of Bihar Act 11, 2007'
                           r'|Repeal and Savings)\s*[.:—–-]*\s*(.*)$'),
        'title': lambda amends, act_title: (f'Amendment of Section {amends}{f" ({act_title})" if act_title else ""} '
                                            'of the Bihar Municipal Act, 2007' if amends else None),
    },
    'municipal_amendment_2022_hi': {
        'start': 'बिहार नगरपालिका (संशोधन) अधिनियम, 2022', 'end': 'ज्योतिस्वरूप',
        'head': re.compile(r'^(\d{1,2})\.\s*(संक्षिप्त नाम, विस्तार और प्रारम्भ|बिहार अधिनियम, 11, 2007 की धारा-(\d+) का संशोधन'
                           r'|निरसन एवं व्यावृत्ति)\s*[।.:—–-]*\s*(.*)$'),
        'title': lambda amends, act_title: (f'बिहार नगरपालिका अधिनियम, 2007 की धारा {amends}'
                                            f'{f" ({act_title})" if act_title else ""} का संशोधन' if amends else None),
    },
}


def pages(key):
    if key.endswith('_hi'):
        data = json.loads((WORK / 'text' / f'{key}.json').read_text(encoding='utf-8'))
        return [(p['page'], p['text']) for p in data['pages']]
    return [(i + 1, p.get_text()) for i, p in enumerate(fitz.open(SOURCE / DOCS[key]['file']))]


def body_lines(key, cfg):
    """Lines of the Act text only: from its title to the signature, without page headers."""
    out, started = [], False
    for page_no, text in pages(key):
        for ln in text.splitlines():
            ln = ln.strip()
            if not started:
                started = cfg['start'] in ln and page_no > 1
                continue
            if cfg['end'] in ln:
                return out
            if ln and not HEADER.match(ln) and not (key.endswith('_en') and DEVANAGARI.search(ln)):
                out.append((page_no, ln))
    return out


def act_titles(sections, lang):
    return {s['section']: s['title'] for s in sections if s['doc'] == f'municipal_act_{lang}'}


def split(key, cfg, titles):
    meta = DOCS[key]
    heads, lines = [], body_lines(key, cfg)
    for k, (page_no, ln) in enumerate(lines):
        m = cfg['head'].match(ln)
        if m:
            heads.append((k, page_no, m))
    out = []
    for j, (k, page_no, m) in enumerate(heads):
        end = heads[j + 1][0] if j + 1 < len(heads) else len(lines)
        body = ([m.group(4)] if m.group(4) else []) + [ln for _, ln in lines[k + 1:end]]
        text = unicodedata.normalize('NFC', re.sub(r'[ \t]+', ' ', '\n'.join(body)).strip())
        amends = m.group(3)
        out.append({'id': f'{key}:s{m.group(1)}', 'doc': key, 'act': meta['title'], 'lang': meta['lang'], 'chapter': '',
                    'section': m.group(1), 'title': cfg['title'](amends, titles.get(amends, '')) or m.group(2),
                    'page': page_no, 'text': text, 'amends': amends,
                    'source': 'font conversion' if meta['lang'] == 'hi' else 'text', 'reliability': 'high'})
    return out


def main():
    path = OUT / 'sections.json'
    sections = [s for s in json.loads(path.read_text(encoding='utf-8')) if s['doc'] not in LANGS]
    for key, cfg in LANGS.items():
        secs = split(key, cfg, act_titles(sections, DOCS[key]['lang']))
        nums = [int(s['section']) for s in secs]
        assert nums == list(range(1, len(nums) + 1)), (key, nums)
        print(f"{key}: {len(secs)} sections, amends {[s['amends'] for s in secs if s['amends']]}")
        sections += secs
    path.write_text(json.dumps(sections, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'total {len(sections)} sections -> {path}')


if __name__ == '__main__':
    main()
