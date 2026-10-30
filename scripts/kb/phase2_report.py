"""Phase 2 report: model/method comparison, per-language scores, FAQ matcher, re-ranker verdict, final choice.

Output: kb-work/report/phase2.html
"""
import html
import json
from datetime import date

from common import OUT, WORK

P2 = WORK / 'phase2'


def pct(x):
    return f'{100 * x:.0f}%' if isinstance(x, (int, float)) else '–'


def main():
    results = json.loads((P2 / 'results.json').read_text(encoding='utf-8'))
    matcher = json.loads((P2 / 'matcher.json').read_text(encoding='utf-8'))
    rerank = json.loads((P2 / 'rerank.json').read_text(encoding='utf-8')) if (P2 / 'rerank.json').exists() else None
    meta = json.loads((OUT / 'index' / 'meta.json').read_text(encoding='utf-8')) if (OUT / 'index' / 'meta.json').exists() else {}
    qs = json.loads((OUT / 'eval' / 'questions.json').read_text(encoding='utf-8'))
    chosen = meta.get('fusion', 'dense:e5-small-ft')

    def row(name, r):
        f, s = r['faq'], r['sec']
        g = lambda d, k, m: d.get(k, {}).get(m)
        cls = ' class="win"' if name == chosen else ''
        return (f'<tr{cls}><td>{html.escape(name)}</td><td>{pct(g(f, "test/all", "R@1"))}</td><td>{pct(g(f, "test/all", "R@3"))}</td>'
                f'<td>{pct(g(f, "test/en", "R@1"))}</td><td>{pct(g(f, "test/hi", "R@1"))}</td><td>{pct(g(f, "test/hl", "R@1"))}</td>'
                f'<td>{pct(g(s, "test/all", "R@1"))}</td><td>{pct(g(s, "test/all", "R@5"))}</td><td>{pct(g(s, "all/all", "R@5"))}</td>'
                f'<td>{g(s, "all/all", "nDCG") or "–"}</td><td>{r.get("query_ms", "")}</td></tr>')

    order = sorted(results, key=lambda n: -(results[n]['faq'].get('test/all', {}).get('R@1', 0)
                                            + results[n]['sec'].get('all/all', {}).get('R@5', 0)))
    table = ''.join(row(n, results[n]) for n in order)

    a, b = matcher['threshold_rule'], matcher['logistic']
    m_rows = (f'<tr><td>Threshold rule (τ={a["tau"]}, δ={a["delta"]})</td><td>{pct(a["test"]["precision"])}</td>'
              f'<td>{pct(a["test"]["recall"])}</td><td>{pct(a["test"]["oos_false_accept"])}</td></tr>'
              f'<tr><td>Logistic regression (p≥{b["p"]})</td><td>{pct(b["test"]["precision"])}</td>'
              f'<td>{pct(b["test"]["recall"])}</td><td>{pct(b["test"]["oos_false_accept"])}</td></tr>')
    if rerank:
        rm = rerank['matcher']
        m_rows += (f'<tr><td>Re-ranker probability (≥{rm["threshold"]})</td><td>{pct(rm["test"]["precision"])}</td>'
                   f'<td>{pct(rm["test"]["recall"])}</td><td>{pct(rm["test"]["oos_false_accept"])}</td></tr>')
        rr = (f'<p>Re-ranker (bge-reranker-v2-m3) on top of {html.escape(rerank["method"])}: FAQ test R@1 '
              f'{pct(rerank["faq"].get("test/all", {}).get("R@1"))}, sections all R@5 {pct(rerank["sec"].get("all/all", {}).get("R@5"))}, '
              f'latency {rerank["latency_ms"]["mean"]} ms/question (p90 {rerank["latency_ms"]["p90"]} ms) on CPU.</p>')
    else:
        rr = '<p>Re-ranker not evaluated.</p>'

    vpath = OUT / 'eval' / 'index_verification.json'
    if vpath.exists():
        v = json.loads(vpath.read_text(encoding='utf-8'))
        f, sct, mt = v['faq'], v['sec'], v['matcher_test']
        verify = (f'<table><tr><th>Query time</th><th>FAQ R@1 test</th><th>EN</th><th>HI</th><th>Hinglish</th><th>Section R@5 test</th>'
                  f'<th>Section R@5 all</th><th>Matcher precision</th><th>Matcher recall</th><th>Out-of-scope accepted</th></tr>'
                  f'<tr><td>{v["query_ms"]} ms</td><td>{pct(f["test/all"]["R@1"])}</td><td>{pct(f["test/en"]["R@1"])}</td>'
                  f'<td>{pct(f["test/hi"]["R@1"])}</td><td>{pct(f["test/hl"]["R@1"])}</td><td>{pct(sct["test/all"]["R@5"])}</td>'
                  f'<td>{pct(sct["all/all"]["R@5"])}</td><td>{pct(mt["precision"])}</td><td>{pct(mt["recall"])}</td><td>{mt["oos_accepted"]}</td></tr></table>')
    else:
        verify = '<p>Not run.</p>'
    counts = {}
    for q in qs:
        counts[(q['type'], q['lang'])] = counts.get((q['type'], q['lang']), 0) + 1
    qtab = ''.join(f'<tr><td>{t}</td><td>{counts.get((t, "en"), 0)}</td><td>{counts.get((t, "hi"), 0)}</td>'
                   f'<td>{counts.get((t, "hl"), 0)}</td></tr>' for t in ('faq', 'act', 'case', 'oos'))

    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SEC Bihar KB - Phase 2 report</title>
<style>body{{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1c2b27;max-width:1300px}}
h1,h2{{color:#075E54}} h2{{border-bottom:2px solid #25D366;padding-bottom:4px;margin-top:30px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}} th,td{{border:1px solid #dfe5e3;padding:5px 8px;text-align:left}}
th{{background:#f3f8f6}} tr.win td{{background:#e9f9ef;font-weight:600}} .box{{background:#f3f8f6;border-left:4px solid #128C7E;padding:10px 14px}}</style>
</head><body><h1>State Election Commission, Bihar — Phase 2: search engine</h1><p>Generated {date.today()}. All offline, CPU only.</p>
<div class="box"><b>Chosen:</b> {html.escape(chosen)} — fine-tuned multilingual-e5-small (118M parameters), exported to ONNX int8 for the Node server.
FAQ matcher: {html.escape(matcher["winner"])} rule. Index: {meta.get("n_chunks", "?")} section chunks + {meta.get("n_faq_units", "?")} FAQ units, {meta.get("dims", "?")} dimensions.</div>
<h2>Evaluation set ({len(qs)} questions; 70% tuning / 30% held-out test)</h2>
<table><tr><th>Type</th><th>English</th><th>Hindi</th><th>Hinglish</th></tr>{qtab}</table>
<h2>Retrieval comparison (test split unless noted)</h2>
<table><tr><th>Method</th><th>FAQ R@1</th><th>FAQ R@3</th><th>FAQ R@1 EN</th><th>FAQ R@1 HI</th><th>FAQ R@1 Hinglish</th>
<th>Section R@1</th><th>Section R@5</th><th>Section R@5 (all)</th><th>nDCG@10 (all)</th><th>ms/query</th></tr>{table}</table>
<p>R@k = correct answer in the top k. Section test split is small (15 questions); "all" = dev + test. Fine-tuned models were trained on the dev split only.</p>
<h2>FAQ matcher (answer directly with the official FAQ text)</h2>
<table><tr><th>Rule</th><th>Precision (test)</th><th>Recall (test)</th><th>Out-of-scope wrongly matched</th></tr>{m_rows}</table>
<h2>Re-ranker</h2>{rr}
<h2>Final index check (as the server runs it: int8 per-channel ONNX + float16 vectors)</h2>{verify}
<h2>Decisions</h2><ul>
<li><b>Chosen: fine-tuned multilingual-e5-small, dense search.</b> Fine-tuning (contrastive, dev split only) raised FAQ test R@1 from 83% to 93%; adding BM25 did not help after fine-tuning.</li>
<li><b>Re-ranker rejected:</b> lower accuracy than the fine-tuned model and ~6.5 s per question on CPU.</li>
<li><b>Rule-based Hinglish transliteration rejected:</b> +2 points only; Hinglish is handled in Phase 3 by AI query rewriting when the match is not confident.</li>
<li><b>MiniLM rejected:</b> weak on Act sections. <b>BGE-M3 not completed:</b> stopped for low memory on the laptop; its 2.3 GB weights also exceed the demo server budget.</li>
<li><b>Explicit section references</b> ("Section 125", "धारा 14") will be looked up directly in Phase 3.</li>
<li><b>Model file (118 MB)</b> exceeds GitHub's 100 MB limit: fetched at Docker build time (Phase 6).</li></ul>
</body></html>'''
    (WORK / 'report').mkdir(parents=True, exist_ok=True)
    (WORK / 'report' / 'phase2.html').write_text(page, encoding='utf-8')
    print('report ->', WORK / 'report' / 'phase2.html')


if __name__ == '__main__':
    main()
