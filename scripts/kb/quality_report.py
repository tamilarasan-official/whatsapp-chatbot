"""Phase 1 - Quality report: source page images next to extracted text, stats, and items for human review.

Output: kb-work/report/index.html (+ img/). Open it in a browser.
"""
import html
import json
import re
import sys
from collections import Counter
from datetime import date

import fitz
from common import DOCS, OUT, SOURCE, WORK

REPORT = WORK / 'report'
IMG = REPORT / 'img'
SAMPLES = {
    'panchayat_act_hi': [5, 41, 120, 250],
    'municipal_act_hi': [21, 31, 90, 112],
    'panchayat_amendment_2021_hi': [1, 2],
    'panchayat_act_en': [6, 120],
    'municipal_act_en': [7, 112],
}


def esc(s):
    return html.escape(str(s))


def load_pages(key, meta):
    if meta['method'] == 'text':
        doc = fitz.open(SOURCE / meta['file'])
        return {i + 1: p.get_text() for i, p in enumerate(doc)}, {}
    folder = 'text' if meta['method'] == 'devlys' else 'ocr'
    path = WORK / folder / f'{key}.json'
    if not path.exists():
        return None, {}
    data = json.loads(path.read_text(encoding='utf-8'))
    return {p['page']: p['text'] for p in data['pages']}, data


def page_image(key, meta, page_no):
    IMG.mkdir(parents=True, exist_ok=True)
    out = IMG / f'{key}-p{page_no}.png'
    if not out.exists():
        fitz.open(SOURCE / meta['file'])[page_no - 1].get_pixmap(dpi=80).save(out)
    return f'img/{out.name}'


def doc_stats(key, meta, pages, data, sections):
    secs = [s for s in sections if s['doc'] == key]
    nums = sorted({int(re.match(r'\d+', s['section']).group()) for s in secs}) if secs else []
    missing = [n for n in range(1, nums[-1] + 1) if n not in nums] if nums else []
    row = {
        'pages': len(pages), 'method': {'text': 'PDF text layer', 'ocr': 'OCR: Tesseract + EasyOCR',
                                        'devlys': 'DevLys → Unicode conversion'}[meta['method']],
        'chars': sum(len(t) for t in pages.values()), 'sections': len(secs),
        'max_section': nums[-1] if nums else '-', 'missing': missing,
    }
    if meta['method'] == 'ocr':
        confs = [p['mean_conf'] for p in data['pages']]
        row['mean_conf'] = round(sum(confs) / len(confs), 1)
        row['low_pages'] = [p['page'] for p in data['pages'] if p['mean_conf'] < 80]
        row['corrections'] = Counter(d['why'] for d in data['decisions'])
    if meta['method'] == 'devlys':
        row['corrupt_pages'] = [p['page'] for p in data['pages'] if p.get('corrupt_spans')]
    return row


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sections = json.loads((OUT / 'sections.json').read_text(encoding='utf-8')) if (OUT / 'sections.json').exists() else []
    faqs = json.loads((OUT / 'faqs.json').read_text(encoding='utf-8')) if (OUT / 'faqs.json').exists() else []

    summary_rows, doc_blocks, review = [], [], []
    for key, meta in DOCS.items():
        pages, data = load_pages(key, meta)
        if pages is None:
            summary_rows.append(f'<tr><td>{esc(meta["title"])}</td><td colspan="6"><i>not processed yet</i></td></tr>')
            continue
        st = doc_stats(key, meta, pages, data, sections)
        quality = ''
        if 'mean_conf' in st:
            quality = f'OCR confidence {st["mean_conf"]}%; EasyOCR corrections: ' + \
                ', '.join(f'{k} {v}' for k, v in st['corrections'].most_common())
            if st['low_pages']:
                review.append(f'{esc(meta["title"])}: low OCR confidence on pages {st["low_pages"][:30]}')
        if st.get('corrupt_pages'):
            quality = f'Corrupted in source PDF on pages {st["corrupt_pages"]}'
            review.append(f'{esc(meta["title"])}: text corrupted in the client PDF on pages {st["corrupt_pages"]} '
                          f'(request a clean copy; English Act covers these sections)')
        if st['missing']:
            review.append(f'{esc(meta["title"])}: {len(st["missing"])} section headings not detected '
                          f'(text kept inside the previous section): {st["missing"][:25]}{" …" if len(st["missing"]) > 25 else ""}')
        summary_rows.append(
            f'<tr><td>{esc(meta["title"])}<br><small>{esc(meta["file"])}</small></td><td>{meta["lang"].upper()}</td>'
            f'<td>{st["method"]}</td><td>{st["pages"]}</td><td>{st["sections"]} <small>(of {st["max_section"]})</small></td>'
            f'<td>{st["chars"]:,}</td><td><small>{esc(quality)}</small></td></tr>')

        samples = []
        for n in SAMPLES.get(key, []):
            if n not in pages:
                continue
            samples.append(f'<div class="pair"><div><h4>Source page {n}</h4><img src="{page_image(key, meta, n)}"></div>'
                           f'<div><h4>Extracted text</h4><pre>{esc(pages[n][:2500])}</pre></div></div>')
        extra = ''
        if meta['method'] == 'ocr' and data.get('decisions'):
            rows = ''.join(f'<tr><td>{d["page"]}</td><td>{esc(d["tesseract"])}</td><td>{esc(d["easyocr"])}</td>'
                           f'<td><b>{esc(d["used"])}</b></td><td>{d["why"]}</td></tr>' for d in data['decisions'][:40])
            extra = (f'<h4>EasyOCR corrections (first 40 of {len(data["decisions"])})</h4><table><tr><th>Page</th>'
                     f'<th>Tesseract read</th><th>EasyOCR read</th><th>Used</th><th>Reason</th></tr>{rows}</table>')
        doc_blocks.append(f'<section><h2>{esc(meta["title"])}</h2>{"".join(samples)}{extra}</section>')

    tr_path = WORK / 'translation' / 'panchayat_amendment_2021_hi.json'
    translation = ''
    if tr_path.exists():
        tr = json.loads(tr_path.read_text(encoding='utf-8'))
        pairs = [p for page in tr['pages'] for p in page['pairs']]
        rows = ''.join(f'<tr><td>{esc(p["hi"])}</td><td>{esc(p["en"])}</td></tr>' for p in pairs[:60])
        translation = (f'<section><h2>2021 Amendment: Hindi → English (IndicTrans2)</h2><p class="warn">'
                       f'{esc(tr["status"])}. {len(pairs)} sentences.</p><table><tr><th>Hindi (OCR)</th><th>English (machine translation)</th></tr>{rows}</table></section>')
        review.append('2021 Amendment English translation is machine-generated: needs review by someone fluent in legal Hindi')

    cats = Counter(f['category'] for f in faqs)
    faq_rows = ''.join(f'<tr><td>{esc(k)}</td><td>{v}</td></tr>' for k, v in cats.most_common())
    sample_faq = faqs[0] if faqs else None
    faq_block = (f'<section><h2>FAQs ({len(faqs)}, English + Hindi)</h2><table><tr><th>Category</th><th>Q&amp;A</th></tr>{faq_rows}</table>'
                 + (f'<div class="pair"><div><h4>{esc(sample_faq["q_en"])}</h4><pre>{esc(sample_faq["a_en"])}</pre></div>'
                    f'<div><h4>{esc(sample_faq["q_hi"])}</h4><pre>{esc(sample_faq["a_hi"])}</pre></div></div>' if sample_faq else '')
                 + '</section>')

    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SEC Bihar KB - Phase 1 quality report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1c2b27;max-width:1300px}}
h1{{color:#075E54}} h2{{color:#075E54;border-bottom:2px solid #25D366;padding-bottom:4px;margin-top:36px}}
table{{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}} th,td{{border:1px solid #dfe5e3;padding:6px 8px;text-align:left;vertical-align:top}}
th{{background:#f3f8f6}} pre{{white-space:pre-wrap;font-family:"Nirmala UI",Mangal,Segoe UI,sans-serif;font-size:13px;background:#fafafa;
border:1px solid #eee;padding:10px;max-height:620px;overflow:auto;margin:0}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0}} .pair img{{width:100%;border:1px solid #ccc}}
h4{{margin:4px 0}} .warn{{background:#fff8e5;border-left:4px solid #e0a100;padding:8px 12px}} li{{margin-bottom:4px}}
</style></head><body>
<h1>State Election Commission, Bihar — Knowledge base: Phase 1 quality report</h1>
<p>Generated {date.today().isoformat()}. All processing is offline and open-source (Tesseract 5, EasyOCR, IndicTrans2).</p>
<h2>Summary</h2><table><tr><th>Document</th><th>Lang</th><th>Method</th><th>Pages</th><th>Sections</th><th>Characters</th><th>Quality</th></tr>
{''.join(summary_rows)}</table>
<h2>Needs human review</h2><ul>{''.join(f'<li>{r}</li>' for r in review) or '<li>Nothing flagged</li>'}</ul>
{faq_block}{''.join(doc_blocks)}{translation}
</body></html>'''
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / 'index.html').write_text(page, encoding='utf-8')
    print(f'report -> {REPORT / "index.html"}  ({len(review)} review items)')


if __name__ == '__main__':
    main()
