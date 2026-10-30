"""Phase 1 - Convert legacy DevLys 010 / Kruti Dev 010 encoded Hindi PDF text to Unicode.

Only text spans whose font is DevLys / Kruti Dev are converted; English spans (Arial, Times) are kept.
Rules: longest-match character mapping, then the two reordering rules of this encoding:
  'f' (ि) is typed before the consonant cluster  -> moved after it
  'Z' (reph, र्) is typed after the syllable       -> moved before the consonant cluster

Usage: python devlys_convert.py <doc_key>
Output: kb-work/text/<doc_key>.json and .txt
"""
import json
import re
import sys
import unicodedata

import fitz
from common import DOCS, SOURCE, WORK

LEGACY_FONTS = ('devlys', 'krutidev', 'kruti dev', 'krishna')
# Some sections of the source PDF are corrupted: Hindi typed in a missing font, so the PDF itself
# displays Latin gibberish (e.g. 'keÀ ceW efveJee&®eve'). These spans are detected and skipped;
# the English Act covers the same sections.
GARBLED_MARKERS = re.compile('[À®³ÙÊÐ¿ÿ]')

# Kruti Dev / DevLys 010 -> Unicode. Applied longest key first.
MAP = {
    # independent vowels
    'v‚': 'ऑ', 'vks': 'ओ', 'vkS': 'औ', 'vk': 'आ', 'v': 'अ', 'b±': 'ईं', 'bZ': 'ई', 'Ã': 'ई', 'b': 'इ',
    'm': 'उ', 'Å': 'ऊ', ',s': 'ऐ', ',': 'ए', '_': 'ऋ',
    # conjuncts and special consonants
    '{k': 'क्ष', '{': 'क्ष्', '=': 'त्र', '«': 'त्र्', 'Ì': 'द्द', 'Ñ': 'कृ', 'K': 'ज्ञ', 'J': 'श्र', 'Ø': 'क्र', 'ä': 'क्त',
    'Ùk': 'त्त', 'Ù': 'त्त्', ')': 'द्ध', '|': 'द्य', '}': 'द्व', 'í': 'द्द', 'æ': 'द्र', 'ç': 'प्र', 'Á': 'प्र',
    'Ý': 'फ्र', 'xz': 'ग्र', '#': 'रु', ':': 'रू', 'ô': 'क्क', 'ê': 'ट्ट', 'ë': 'ट्ठ', 'ì': 'ड्ड', 'ï': 'ड्ढ',
    'à': 'ह्न', 'á': 'ह्य', 'â': 'हृ', 'ã': 'ह्म', 'ºz': 'ह्र', 'º': 'ह्', '–': 'दृ', '—': 'कृ', 'é': 'न्न', '™': 'न्न्',
    'Nî': 'छ्य', 'Vî': 'ट्य', 'Bî': 'ठ्य', 'Mî': 'ड्य', '<î': 'ढ्य', 'Vª': 'ट्र', 'Mª': 'ड्र', '<ª': 'ढ्र', 'Nª': 'छ्र',
    # nukta forms
    'M+': 'ड़', '<+': 'ढ़', 'd+': 'क़', '[+k': 'ख़', 'x+': 'ग़', 'T+': 'ज़्', 't+': 'ज़', 'Q+': 'फ़', ';+': 'य़', 'j+': 'ऱ', 'u+': 'ऩ', '¶+': 'फ़्',
    # consonants (full form = half form + k)
    'd': 'क', 'Dk': 'क', 'D': 'क्', '[k': 'ख', '[': 'ख्', 'x': 'ग', 'Xk': 'ग', 'X': 'ग्', 'Ä': 'घ', '?k': 'घ', '?': 'घ्',
    '³': 'ङ', 'p': 'च', 'Pk': 'च', 'P': 'च्', 'N': 'छ', 't': 'ज', 'Tk': 'ज', 'T': 'ज्', '>': 'झ', '÷': 'झ्', '¥': 'ञ',
    'V': 'ट', 'B': 'ठ', 'M': 'ड', '<': 'ढ', '.k': 'ण', '.': 'ण्', 'r': 'त', 'Rk': 'त', 'R': 'त्', 'Fk': 'थ', 'F': 'थ्',
    'n': 'द', '/k': 'ध', 'èk': 'ध', '/': 'ध्', 'Ë': 'ध्', 'è': 'ध्', 'u': 'न', 'Uk': 'न', 'U': 'न्',
    'i': 'प', 'Ik': 'प', 'I': 'प्', 'Q': 'फ', '¶': 'फ्', 'c': 'ब', 'Ck': 'ब', 'C': 'ब्', 'Hk': 'भ', 'H': 'भ्',
    'e': 'म', 'Ek': 'म', 'E': 'म्', ';': 'य', '¸': 'य्', 'j': 'र', 'y': 'ल', 'Yk': 'ल', 'Y': 'ल्', 'G': 'ळ',
    'o': 'व', 'Ok': 'व', 'O': 'व्', "'k": 'श', "'": 'श्', '"k': 'ष', '"': 'ष्', 'l': 'स', 'Lk': 'स', 'L': 'स्', 'g': 'ह',
    # vowel signs and marks
    '‚': 'ॉ', 'ks': 'ो', 'kS': 'ौ', 'k': 'ा', 'h': 'ी', 'q': 'ु', 'w': 'ू', '`': 'ृ', 's': 'े', 'S': 'ै',
    'a': 'ं', '¡': 'ँ', '%': 'ः', 'W': 'ॅ', 'È': 'ीं', 'z': '्र', 'ª': '्र', '~': '्', '+': '़', '·': 'ऽ', '•': 'ऽ',
    # punctuation
    'A': '।', '-': '.', '&': '-', '¼': '(', '½': ')', '¿': '{', 'À': '}', '@': '/', ']': ',', '^': '‘', '*': '’',
    'Þ': '“', 'ß': '”', '\\': '?', '(': ';', 'ñ': '॰', 'Œ': '॰',
    # digits drawn in the Devanagari style
    'å': '0', 'ƒ': '1', '„': '2', '…': '3', '†': '4', '‡': '5', 'ˆ': '6', '‰': '7', 'Š': '8', '‹': '9',
}
KEYS = sorted(MAP, key=len, reverse=True)
TOKEN = re.compile('|'.join(re.escape(k) for k in KEYS))

CONSONANT = '[क-हक़-य़]़?'
CLUSTER = f'(?:{CONSONANT}्)*{CONSONANT}'
MATRAS = '[ा-ौॢॣँं]*'
I_SIGN = re.compile(f'f({CLUSTER})')
REPH = re.compile(f'({CLUSTER})({MATRAS})Z')


def convert(text):
    out = TOKEN.sub(lambda m: MAP[m.group(0)], text)
    for _ in range(3):  # nested cases (e.g. f + cluster that itself gains a reph)
        out = I_SIGN.sub(lambda m: m.group(1) + 'ि', out)
        out = REPH.sub(lambda m: 'र्' + m.group(1) + m.group(2), out)
    out = out.replace('f', 'ि').replace('Z', 'र्')  # leftovers at span edges
    out = out.replace('ाे', 'ो').replace('ाै', 'ौ').replace('्ा', '').replace('ेै', 'ै')
    out = re.sub('([ंँ])([ा-ौ])', lambda m: m.group(2) + m.group(1), out)  # ं typed before matra
    out = re.sub(r'\s*ः\s*-', ':-', out)  # section-heading colon
    return unicodedata.normalize('NFC', out)


def is_legacy(font):
    f = font.lower().replace('-', '').replace('_', '')
    return any(name.replace(' ', '') in f for name in LEGACY_FONTS)


def is_garbled_hindi(span):
    t = span['text']
    letters = re.findall(r'[A-Za-z]', t)
    if is_legacy(span['font']) or len(letters) < 3:
        return False
    return bool(GARBLED_MARKERS.search(t)) or letters.count('e') / len(letters) > 0.3


def page_text(page, stats):
    lines = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            parts = []
            for span in line['spans']:
                if is_legacy(span['font']):
                    parts.append(convert(span['text']))
                elif is_garbled_hindi(span):
                    stats['corrupt_spans'] += 1  # unreadable in the source PDF itself; English Act covers it
                else:
                    parts.append(span['text'])
            text = re.sub(r'[ \t]+', ' ', ''.join(parts)).strip()
            if text:
                lines.append(text)
    return '\n'.join(lines)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    key = sys.argv[1]
    doc = fitz.open(SOURCE / DOCS[key]['file'])
    pages = []
    for i, p in enumerate(doc):
        stats = {'corrupt_spans': 0}
        pages.append({'page': i + 1, 'text': page_text(p, stats), 'corrupt_spans': stats['corrupt_spans']})
    out_dir = WORK / 'text'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f'{key}.json').write_text(json.dumps({'doc': key, 'pages': pages}, ensure_ascii=False, indent=1), encoding='utf-8')
    (out_dir / f'{key}.txt').write_text('\n\n'.join(f"[[page {p['page']}]]\n{p['text']}" for p in pages), encoding='utf-8')
    leftovers = sum(len(re.findall(r'[A-Za-z]', p['text'])) for p in pages)
    corrupt = [p['page'] for p in pages if p['corrupt_spans']]
    print(f'{key}: {len(pages)} pages converted; {sum(p["corrupt_spans"] for p in pages)} corrupted spans skipped '
          f'on {len(corrupt)} pages; Latin letters remaining: {leftovers}')


if __name__ == '__main__':
    main()
