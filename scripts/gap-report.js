// Weekly knowledge-gap report: the questions the documents did not answer, grouped, most asked first, each
// with a draft answer from the official websites for the Commission to review and approve as a new FAQ.
// Usage:
//   node scripts/gap-report.js --file logs/gaps.jsonl [--days 7] [--top 20] [--out gap-report.html]
//   ADMIN_TOKEN=... node scripts/gap-report.js --url https://apivalardemo.welocalhost.com [--days 7]
require('dotenv').config({ quiet: true });
// not a live chat: the website search may take longer than the bot's 15 s
process.env.WEB_TIMEOUT_MS = process.env.WEB_TIMEOUT_MS || '45000';
const fs = require('fs');
const search = require('../server/search');
const llm = require('../server/llm');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const DAYS = Number(arg('days', 7));
const TOP = Number(arg('top', 20));
const OUT = arg('out', 'gap-report.html');
const SAME_QUESTION = 0.75; // cosine above which two questions are grouped (paraphrases ~0.8, other questions < 0.5)
const LANGUAGE_NAMES = { hi: 'Hindi (Devanagari)', en: 'English', mixed: 'Hinglish' };

async function loadGaps() {
  if (arg('url')) {
    const res = await fetch(`${arg('url')}/api/admin/gaps?limit=2000`, { headers: { 'x-admin-token': process.env.ADMIN_TOKEN || '' } });
    if (!res.ok) throw new Error(`gap log: HTTP ${res.status} (is ADMIN_TOKEN set on the server and here?)`);
    return (await res.json()).gaps;
  }
  const file = arg('file', process.env.GAP_LOG_FILE || 'logs/gaps.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Greedy grouping on the search model's embeddings (the same model the bot searches with).
async function group(gaps) {
  const vectors = await search.embed(gaps.map((g) => g.question));
  const groups = [];
  gaps.forEach((g, i) => {
    let best = null;
    let bestSim = SAME_QUESTION;
    for (const grp of groups) {
      let sim = 0;
      for (let d = 0; d < vectors[i].length; d++) sim += vectors[i][d] * grp.vector[d];
      if (sim > bestSim) [best, bestSim] = [grp, sim];
    }
    if (best) best.items.push(g);
    else groups.push({ vector: vectors[i], items: [g] });
  });
  return groups.sort((a, b) => b.items.length - a.items.length);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function html(rows, total, since) {
  const body = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.count}</td><td><b>${esc(r.question)}</b>`
    + `${r.variants.length ? `<br><small>also asked: ${r.variants.map(esc).join(' · ')}</small>` : ''}</td>`
    + `<td>${esc(r.coverage)}</td><td>${r.draft ? esc(r.draft.reply) : '<i>Not found on the official websites: needs an answer from the Commission</i>'}`
    + `${r.draft ? `<br><small>${r.draft.pages.map((p) => `<a href="${esc(p.url)}">${esc(p.title)}</a>`).join(' · ')}</small>` : ''}</td>`
    + '<td>☐ approve as FAQ</td></tr>').join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Knowledge gap report</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:6px 8px;vertical-align:top;text-align:left}th{background:#075E54;color:#fff}
small{color:#555}</style></head><body>
<h1>SEC Bihar help desk: knowledge gap report</h1>
<p>${total} questions since ${esc(since.slice(0, 10))} were not fully answered by the Commission's documents in the bot.
The most asked are listed below with a <b>draft answer from the official websites</b>. Please check each draft;
approved answers are added to the bot as official FAQs.</p>
<table><tr><th>#</th><th>Times asked</th><th>Question</th><th>Bot's documents</th><th>Draft answer (official websites)</th><th>Decision</th></tr>
${body}</table></body></html>`;
}

(async () => {
  const since = new Date(Date.now() - DAYS * 86400e3).toISOString();
  const gaps = (await loadGaps()).filter((g) => g.at >= since && g.question);
  if (!gaps.length) return console.log(`No gaps in the last ${DAYS} days.`);
  const groups = (await group(gaps)).slice(0, TOP);
  const rows = [];
  for (const grp of groups) {
    const first = grp.items[0];
    const draft = await llm.webAnswer({ message: first.question, history: [], languageName: LANGUAGE_NAMES[first.lang] || 'English' });
    rows.push({
      question: first.question, count: grp.items.length, coverage: first.coverage, draft,
      variants: [...new Set(grp.items.slice(1).map((g) => g.question))].slice(0, 3),
    });
    console.log(`${grp.items.length}x ${first.question.slice(0, 70)} -> ${draft ? 'draft' : 'no draft'}`);
  }
  fs.writeFileSync(OUT, html(rows, gaps.length, since));
  console.log(`\n${gaps.length} gaps, ${groups.length} groups -> ${OUT}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
