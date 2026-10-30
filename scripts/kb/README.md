# Knowledge-base pipeline (Phase 1)

Turns the SEC Bihar source documents into `data/kb/sections.json` and `data/kb/faqs.json`.
Everything runs offline with open-source tools; no OpenAI calls.

## Setup (once, Windows)

1. Tesseract 5 (UB-Mannheim build) at `C:\Program Files\Tesseract-OCR`, plus the `tessdata_best`
   models `hin`, `eng` (and `osd`) in `C:\Users\thami\tools\tessdata`.
   Override with the `TESSERACT_EXE` / `TESSDATA_PREFIX` environment variables.
2. Python environment:
   ```
   python -m venv --system-site-packages scripts/kb/.venv
   scripts/kb/.venv/Scripts/python -m pip install -r scripts/kb/requirements.txt
   ```
3. IndicTrans2 is a gated model: log in once with a free Hugging Face token that has accepted
   https://huggingface.co/ai4bharat/indictrans2-indic-en-dist-200M

Put the client's files in `kb-source/` (git-ignored). Names are mapped in `common.py` (`DOCS`).

## Run order

| Step | Command | Output |
|---|---|---|
| OCR Hindi PDFs with no usable text (Tesseract + EasyOCR) | `python ocr_hindi.py panchayat_act_hi` and `python ocr_hindi.py panchayat_amendment_2021_hi` | `kb-work/ocr/` (per-page cache, resumable) |
| Convert DevLys/Kruti Dev Hindi to Unicode | `python devlys_convert.py municipal_act_hi` | `kb-work/text/` |
| Translate Hindi-only documents to English (IndicTrans2) | `python translate_hi_en.py panchayat_amendment_2021_hi` | `kb-work/translation/` |
| Split all Acts into sections (applies `data/kb/corrections.json`) | `python extract_sections.py` | `data/kb/sections.json` |
| eVoting case study: chapters + text from posters/screenshots | `python extract_case_study.py` | merged into `data/kb/sections.json` |
| English twin of Hindi-only sections (IndicTrans2) | `python translate_hi_en.py --sections panchayat_amendment_2021_hi` | merged into `data/kb/sections.json` |
| Merge FAQ sheets | `python build_faqs.py` | `data/kb/faqs.json` |
| Quality report | `python quality_report.py` | `kb-work/report/index.html` |

Run the scripts from `scripts/kb/` with the venv Python.

## Reliability and corrections

Every entry in `sections.json` has `source` and `reliability`:
`high` = PDF text layer or exact font conversion; `medium` = OCR or machine translation;
`low` = multi-column newspaper clippings / low-confidence images (background only, never cite numbers).

Reviewed fixes to source text (e.g. OCR digit errors) go in `data/kb/corrections.json` with a reason;
`extract_sections.py` re-applies them on every run.
