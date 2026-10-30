"""Phase 1 - Merge the client's FAQ sheets into one clean bilingual file.

Output: data/kb/faqs.json [{id, set, category, audience, q_en, a_en, q_hi, a_hi, keywords_en, keywords_hi, source}]
audience: "public" or "officials" (software / data-entry rules for election staff).
"""
import json
import re
import sys
import unicodedata

import openpyxl
from common import OUT, SOURCE

SHEETS = [
    # (file, sheet, set id, category EN, category HI)
    ('FAQs.xlsx', 'Nagarpalika FAQ', 'municipal', 'Municipal elections', 'नगरपालिका निर्वाचन'),
    ('FAQs.xlsx', 'Nagarpanchayat FAQ', 'panchayat', 'Panchayat elections', 'पंचायत निर्वाचन'),
    ('nicci_response_format_639159231567130677(2) (1).xlsx', 'Sheet1', 'evoting', 'eVoting SECBHR app', 'eVoting SECBHR ऐप'),
]
OFFICIALS = re.compile(r'software|log in|computer system|chauhaddi|ward from the|population of a ward|'
                       r'panchayat samiti continue|transition|merged into a nagar|shifted to a nagar', re.I)


def clean(value):
    if value is None:
        return ''
    text = unicodedata.normalize('NFC', str(value)).replace('\r', '')
    text = re.sub(r'^\s*(?:Q|Que|प्रश्न)\s*[:.]\s*', '', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\s*•\s*', '\n• ', text).strip()
    return re.sub(r'\n{3,}', '\n\n', text)


def keywords(value):
    return [k.strip() for k in re.split(r'[,،]', clean(value)) if k.strip()]


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    faqs = []
    for file, sheet, set_id, cat_en, cat_hi in SHEETS:
        ws = openpyxl.load_workbook(SOURCE / file, read_only=True, data_only=True)[sheet]
        rows = list(ws.iter_rows(values_only=True))
        header = [str(h).strip() if h else '' for h in rows[0]]
        col = {name: i for i, name in enumerate(header)}
        n = 0
        for row in rows[1:]:
            get = lambda name: clean(row[col[name]]) if name in col and col[name] < len(row) else ''
            q_en, a_en, q_hi, a_hi = get('Questions_In_English'), get('Answers_In_English'), \
                get('Questions_In_Hindi'), get('Answers_In_Hindi')
            if not (q_en and a_en):
                continue  # title rows ("नगरपालिका आम निर्वाचन (सामान्य प्रश्न)") and blanks
            n += 1
            officials = set_id == 'evoting' and bool(OFFICIALS.search(q_en))
            faqs.append({
                'id': f'{set_id}_{n:02d}',
                'set': set_id,
                'category': 'Election officials: software rules' if officials else cat_en,
                'category_hi': 'निर्वाचन पदाधिकारी: सॉफ्टवेयर नियम' if officials else cat_hi,
                'audience': 'officials' if officials else 'public',
                'q_en': q_en, 'a_en': a_en, 'q_hi': q_hi, 'a_hi': a_hi,
                'keywords_en': keywords(row[col['English_Keywords']]) if 'English_Keywords' in col else [],
                'keywords_hi': keywords(row[col['Hindi_Keywords']]) if 'Hindi_Keywords' in col else [],
                'source': f'SEC Bihar FAQ ({cat_en})',
            })
        print(f'{file} / {sheet}: {n} Q&A')

    missing_hi = [f['id'] for f in faqs if not (f['q_hi'] and f['a_hi'])]
    (OUT / 'faqs.json').write_text(json.dumps(faqs, ensure_ascii=False, indent=1), encoding='utf-8')
    by = {}
    for f in faqs:
        by[f['category']] = by.get(f['category'], 0) + 1
    print(f'total {len(faqs)} FAQs; by category {by}; missing Hindi: {missing_hi or "none"}')


if __name__ == '__main__':
    main()
