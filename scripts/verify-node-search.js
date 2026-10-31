// Phase 3 - Re-run the Phase 2 evaluation through the Node search engine (server/search.js).
// Confirms the server ranks exactly as verified in Python, and prints score bands for the answer engine.
// Usage: node scripts/verify-node-search.js
const fs = require('fs');
const path = require('path');
const search = require('../server/search');

const qs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kb', 'eval', 'questions.json'), 'utf8'));

function pct(n, d) { return d ? `${((100 * n) / d).toFixed(1)}%` : '-'; }
function quantile(xs, p) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))].toFixed(3) : '-'; }

(async () => {
  await search.loadModel();
  const t = performance.now();
  const rows = [];
  for (const q of qs) {
    const query = { texts: [q.text], vectors: await search.embed([q.text]) };
    rows.push({ q, faq: search.searchFaq(query, { includeOfficials: true, limit: 5 }), sec: search.searchSections(query, { limit: 5 }) });
  }
  const ms = (performance.now() - t) / qs.length;
  const faqHit = (r) => r.q.gold_faq.includes(r.faq[0].key);
  for (const split of ['test', 'all']) {
    const sel = rows.filter((r) => split === 'all' || r.q.split === split);
    const f = sel.filter((r) => r.q.type === 'faq');
    const s = sel.filter((r) => r.q.type === 'act' || r.q.type === 'case');
    const line = ['en', 'hi', 'hl'].map((l) => { const x = f.filter((r) => r.q.lang === l); return `${l} ${pct(x.filter(faqHit).length, x.length)}`; }).join(' ');
    const r5 = s.filter((r) => r.sec.some((x) => r.q.gold_sections.includes(x.key))).length;
    console.log(`${split}: FAQ R@1 ${pct(f.filter(faqHit).length, f.length)} (${line}) | section R@5 ${pct(r5, s.length)}`);
  }
  const test = rows.filter((r) => r.q.split === 'test');
  const acc = test.filter((r) => r.faq[0].confident);
  console.log(`matcher (test): accepted ${acc.length}, precision ${pct(acc.filter((r) => r.q.type === 'faq' && faqHit(r)).length, acc.length)}, recall ${pct(acc.filter((r) => r.q.type === 'faq' && faqHit(r)).length, test.filter((r) => r.q.type === 'faq').length)}, out-of-scope accepted ${acc.filter((r) => r.q.type === 'oos').length}`);
  for (const type of ['faq', 'act', 'case', 'oos']) {
    const x = rows.filter((r) => r.q.type === type);
    console.log(`${type.padEnd(4)} top FAQ score p10/p50/p90 ${quantile(x.map((r) => r.faq[0].score), 0.1)}/${quantile(x.map((r) => r.faq[0].score), 0.5)}/${quantile(x.map((r) => r.faq[0].score), 0.9)} | top section ${quantile(x.map((r) => r.sec[0].score), 0.1)}/${quantile(x.map((r) => r.sec[0].score), 0.5)}/${quantile(x.map((r) => r.sec[0].score), 0.9)}`);
  }
  console.log(`${ms.toFixed(1)} ms per question (embed + search)`);
})();
