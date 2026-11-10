"""Shared paths and helpers for the knowledge-base pipeline (Phase 1)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'kb-source'          # raw client files (git-ignored)
WORK = ROOT / 'kb-work'              # OCR cache, page images, reports (git-ignored)
OUT = ROOT / 'data' / 'kb'           # processed knowledge base (committed)

TESSERACT_EXE = os.environ.get('TESSERACT_EXE', r'C:\Program Files\Tesseract-OCR\tesseract.exe')
TESSDATA = os.environ.get('TESSDATA_PREFIX', r'C:\Users\thami\tools\tessdata')

DOCS = {
    'panchayat_act_en': {'file': 'ACT_Bihar Panchayat Raj Act 2006 - English.pdf', 'title': 'Bihar Panchayat Raj Act, 2006', 'lang': 'en', 'method': 'text'},
    'panchayat_act_hi': {'file': 'ACT_Bihar Panchayat Raj Act 2006.pdf', 'title': 'बिहार पंचायत राज अधिनियम, 2006', 'lang': 'hi', 'method': 'ocr'},
    'municipal_act_en': {'file': 'The Bihar Municipal Act-2007( English).pdf', 'title': 'Bihar Municipal Act, 2007', 'lang': 'en', 'method': 'text'},
    'municipal_act_hi': {'file': 'AR-02-29-03-2007.pdf', 'title': 'बिहार नगरपालिका अधिनियम, 2007', 'lang': 'hi', 'method': 'devlys'},
    'panchayat_amendment_2021_hi': {'file': 'Gazette_674_9_8_2021.pdf', 'title': 'बिहार पंचायत राज (संशोधन) अधिनियम, 2021', 'lang': 'hi', 'method': 'ocr'},
    # One gazette, Hindi (DevLys, pages 1-4) then English (pages 4-8): extract_amendment_2022.py
    'municipal_amendment_2022_hi': {'file': 'Gazette_176_2_4_2022.pdf', 'title': 'बिहार नगरपालिका (संशोधन) अधिनियम, 2022', 'lang': 'hi', 'method': 'amendment'},
    'municipal_amendment_2022_en': {'file': 'Gazette_176_2_4_2022.pdf', 'title': 'Bihar Municipal (Amendment) Act, 2022', 'lang': 'en', 'method': 'amendment'},
    # Chapters (not numbered sections) + awareness posters/app screenshots read from images
    'evoting_case_study_en': {'file': 'Case Study - eVoting v0.2.pdf',
                              'title': "Digital Democracy in Action: Bihar's eVoting Success Story @ ULB Elections 2025",
                              'lang': 'en', 'method': 'chapters'},
}

os.environ['TESSDATA_PREFIX'] = TESSDATA

for d in (WORK, OUT):
    d.mkdir(parents=True, exist_ok=True)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
