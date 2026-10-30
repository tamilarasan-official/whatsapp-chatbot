"""Phase 1 - Split every Act (English text layer, converted Hindi, OCR'd Hindi) into sections.

Output: data/kb/sections.json  [{id, doc, act, lang, chapter, section, title, page, text}]
A section heading is "<number>. <Title> -"; numbers must keep increasing, which rejects numbered
lists inside sections. A table of contents (short entries, numbering restarting at 1) is dropped
by keeping, for each section number, the occurrence with the longest body.
"""
import json
import re
import sys
import unicodedata

import fitz
from common import DOCS, OUT, SOURCE, WORK

PAGE_NO = re.compile(r'^\s*(?:\d{1,3}|[-.]\s*\d{1,3}\s*[-.])\s*$|^\s*[ivxlc]+\s*$', re.I)  # 2 | - 2 - | . 70 .
CLAUSE_ONLY = re.compile(r'^\s*\(?([0-9]{1,3}|[a-z]{1,3}|[ivxl]{1,6})\)\s*$', re.I)
NUMBER_ONLY = re.compile(r'^\s*\d{1,3}[A-Zक-ह]?\.\s*$')  # "3." on its own line, title on the next
HEAD_EN = re.compile(r'^\s*(\d{1,3}[A-Z]?)\.\s+([A-Z][^\n]{2,160}?)\s*[–—\-:.]+\s*(.*)$')
HEAD_HI = re.compile(r'^\s*(\d{1,3}[क-ह]?)\s*\.[\s.]*([ऀ-ॿ][^\n:।]{1,120}?)'
                     r'(?:\s*(?:।\s*[-–—]|:-|[-–—]|:)\s*(.*)|\s*(?=\(1\))(.*)|\s*$())')
# Tesseract reads this font's "1" as "4" (10 -> 40, 104 -> 404). Each heading number may be read either way;
# the longest-increasing-run step picks the reading that fits the section order.
OCR_DIGIT_CONFUSIONS = {'panchayat_act_hi': ('4', '1'), 'panchayat_amendment_2021_hi': ('4', '1')}
CHAPTER = re.compile(r'^\s*(chapter|अध्याय)\s*[-–—.]?\s*([IVXLC]+|\d+)\b', re.I)


def clean_lines(text):
    lines = [ln.rstrip() for ln in text.replace('�', '–').splitlines()]
    lines = [ln for ln in lines if ln.strip() and not PAGE_NO.match(ln)]
    out = []
    for ln in lines:
        if out and (CLAUSE_ONLY.match(out[-1]) or NUMBER_ONLY.match(out[-1])):
            out[-1] = out[-1].strip() + ' ' + ln.strip()
        else:
            out.append(ln.strip())
    return out


def pages_for(key, meta):
    if meta['method'] == 'text':
        doc = fitz.open(SOURCE / meta['file'])
        return [(i + 1, p.get_text()) for i, p in enumerate(doc)]
    folder = 'text' if meta['method'] == 'devlys' else 'ocr'
    data = json.loads((WORK / folder / f'{key}.json').read_text(encoding='utf-8'))
    return [(p['page'], p['text']) for p in data['pages']]


def section_number(s):
    return int(re.match(r'\d+', s).group(0))


def number_readings(section, confusion):
    """All readings of an OCR'd section number, e.g. '404' -> {'404', '104', '401', '101'} when 4 may be 1."""
    readings = {section}
    if confusion:
        wrong, right = confusion
        digits = re.match(r'\d+', section).group(0)
        suffix = section[len(digits):]
        positions = [i for i, ch in enumerate(digits) if ch == wrong]
        for mask in range(1, 2 ** len(positions)):
            d = list(digits)
            for b, pos in enumerate(positions):
                if mask >> b & 1:
                    d[pos] = right
            readings.add(''.join(d) + suffix)
    return sorted(readings, key=section_number)


def longest_increasing(heads):
    """Longest run of headings whose section numbers strictly increase, choosing one reading per heading.

    Dynamic programming over (heading, reading) pairs; O((n*r)^2) with n < 1000 headings, r <= 8 readings.
    Returns {heading index: chosen section string}.
    """
    nodes = [(i, s) for i, h in enumerate(heads) for s in h['readings']]
    best, prev = [1] * len(nodes), [-1] * len(nodes)
    for b, (i, s) in enumerate(nodes):
        n = section_number(s)
        for a in range(b):
            j, t = nodes[a]
            if j < i and section_number(t) < n and best[a] + 1 > best[b]:
                best[b], prev[b] = best[a] + 1, a
    k = max(range(len(nodes)), key=lambda x: best[x]) if nodes else -1
    chosen = {}
    while k != -1:
        chosen[nodes[k][0]] = nodes[k][1]
        k = prev[k]
    return chosen


def split_sections(key, meta):
    """Find candidate headings, keep the longest increasing run of section numbers, cut the text between them."""
    head = HEAD_EN if meta['lang'] == 'en' else HEAD_HI
    confusion = OCR_DIGIT_CONFUSIONS.get(key)
    lines, heads, chapter = [], [], ''
    for page_no, text in pages_for(key, meta):
        for ln in clean_lines(text):
            ch = CHAPTER.match(ln)
            if ch:
                chapter = f'{ch.group(1).title()} {ch.group(2)}'
            m = head.match(ln)
            if m:
                rest = next((g for g in m.groups()[2:] if g), '')
                heads.append({'line': len(lines), 'section': m.group(1), 'readings': number_readings(m.group(1), confusion),
                              'title': m.group(2).strip(' .-–—'), 'rest': rest, 'chapter': chapter, 'page': page_no})
            lines.append(ln)

    # A table of contents repeats the numbering before the body; the body run has the longer bodies, so
    # take the increasing run over headings that are followed by real text (>= 2 lines before the next heading).
    real = [h for k, h in enumerate(heads)
            if (heads[k + 1]['line'] if k + 1 < len(heads) else len(lines)) - h['line'] >= 2 or len(h['rest']) > 40]
    chosen = longest_increasing(real)
    keep = []
    for k, h in enumerate(real):
        if k in chosen:
            h['section'] = chosen[k]
            keep.append(h)

    sections = []
    for k, h in enumerate(keep):
        end = keep[k + 1]['line'] if k + 1 < len(keep) else len(lines)
        body = ([h['rest']] if h['rest'] else []) + lines[h['line'] + 1:end]
        text = unicodedata.normalize('NFC', re.sub(r'[ \t]+', ' ', '\n'.join(body)).strip())
        if len(text) >= 40:
            sections.append({'id': f"{key}:s{h['section']}", 'doc': key, 'act': meta['title'], 'lang': meta['lang'],
                             'chapter': h['chapter'], 'section': h['section'], 'title': h['title'],
                             'page': h['page'], 'text': text,
                             'source': {'text': 'text', 'devlys': 'font conversion', 'ocr': 'OCR'}[meta['method']],
                             'reliability': 'medium' if meta['method'] == 'ocr' else 'high'})
    return apply_corrections(key, sections)


def apply_corrections(key, sections):
    """Apply reviewed, documented fixes from data/kb/corrections.json (e.g. OCR digit errors)."""
    path = OUT / 'corrections.json'
    fixes = [f for f in json.loads(path.read_text(encoding='utf-8')) if f['doc'] == key] if path.exists() else []
    for f in fixes:
        pattern = re.escape(f['find']) + (r'(?!\d)' if f.get('whole_number') else '')
        for sec in sections:
            if sec['section'] == f['section']:
                sec['title'] = re.sub(pattern, f['replace'], sec['title'])
                sec['text'] = re.sub(pattern, f['replace'], sec['text'])
                sec.setdefault('corrections', []).append(f'{f["find"]} -> {f["replace"]}: {f["reason"]}')
    return sections


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    only = sys.argv[1:] or list(DOCS)
    path = OUT / 'sections.json'
    existing = json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    keep = [s for s in existing if s['doc'] not in only]
    only = [k for k in only if DOCS[k]['method'] != 'chapters']  # chapters: extract_case_study.py
    keep = [s for s in existing if s['doc'] not in only]
    for key in only:
        meta = DOCS[key]
        try:
            secs = split_sections(key, meta)
        except FileNotFoundError:
            print(f'{key}: source text not ready yet, skipped')
            continue
        keep += secs
        nums = [section_number(s['section']) for s in secs]
        print(f"{key}: {len(secs)} sections (numbers {min(nums) if nums else '-'}..{max(nums) if nums else '-'}), "
              f"{sum(len(s['text']) for s in secs):,} chars")
    path.write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'total {len(keep)} sections -> {path}')


if __name__ == '__main__':
    main()
