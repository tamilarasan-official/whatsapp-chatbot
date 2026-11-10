// Regression test before a deploy: every official FAQ, every suggested follow-up question, and fixed cases.
// Exits with code 1 when a check is below its limit.
// Usage: npm run test:regression [-- --quick]     (server running; start it with RATE_LIMIT_PER_MIN=1000)
//        BASE_URL=https://apivalardemo.welocalhost.com npm run test:regression -- --quick
// --quick: 15 FAQs per language for the follow-up taps instead of all.
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const QUICK = process.argv.includes('--quick');
const PARALLEL = 4;
const FAQS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'kb', 'faqs.json'), 'utf8'));
// Many FAQs are in both the Panchayat and the Municipal sheet with the same question: either one is correct.
const sameQuestion = (a, b) => a.q_en.trim().toLowerCase() === b.q_en.trim().toLowerCase();
const twins = new Map(FAQS.map((f) => [f.id, FAQS.filter((g) => sameQuestion(f, g)).map((g) => g.id)]));
const LIMITS = { faqCorrect: 0.97, tapDeadEnds: 0.02 };

const cites = (r) => (r.citations || []).map((c) => c.faq_id || c.key || c.url);
// no source, and not a reply that needs none (small talk, out of scope, the PDF list, an officer)
const isDeadEnd = (r) => !cites(r).length && r.route === 'chat' && !['out_of_scope', 'smalltalk'].includes(r.intent)
  && !['documents', 'handover'].includes(r.action);

// Fixed cases: questions that were answered wrongly before, with what the answer must show.
const CASES = [
  { q: 'How is the Mayor elected?', lang: 'en', ok: (r) => cites(r).includes('amend2022:6') && /direct/i.test(r.reply) },
  { q: 'Can a no confidence motion be brought against the Mayor?', lang: 'en',
    ok: (r) => cites(r).includes('amend2022:8') && /\b(no|not|cannot)\b/i.test(r.reply) },
  { q: 'क्या मेयर के खिलाफ अविश्वास प्रस्ताव लाया जा सकता है?', lang: 'hi', ok: (r) => cites(r).includes('amend2022:8') && /नहीं/.test(r.reply) },
  { q: 'What is the nomination fee for Mukhiya?', lang: 'en', ok: (r) => /1,?000/.test(r.reply) && cites(r).length > 0 },
  { q: 'Send me the municipal amendment act 2022', lang: 'en', ok: (r) => r.action === 'documents' },
  { q: 'What is the Candidate Suvidha portal?', lang: 'en', ok: (r) => cites(r).includes('municipal_09'),
    then: { q: 'How to apply offline?', ok: (r) => /returning officer/i.test(r.reply) } },
  { q: 'How do I get a new voter ID card?', lang: 'en', ok: (r) => /voters\.eci\.gov\.in|1950/.test(r.reply) },
  { q: 'Which party should I vote for?', lang: 'en', ok: (r) => r.intent === 'out_of_scope' && !cites(r).length },
  { q: 'आज पटना का मौसम कैसा है?', lang: 'hi', ok: (r) => r.intent === 'out_of_scope' },
  { q: 'This is useless, connect me to a real person!', lang: 'en', ok: (r) => r.action === 'handover' },
];

async function chat(message, language, history = [], prevSources = []) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, language, mode: 'ai', history, context: { prevSources } }),
  });
  if (res.status === 429) throw new Error('rate limited: start the server with RATE_LIMIT_PER_MIN=1000');
  return res.json();
}

async function inParallel(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function faqCheck() {
  const jobs = FAQS.flatMap((f) => [{ f, lang: 'en', q: f.q_en }, { f, lang: 'hi', q: f.q_hi }]).filter((j) => j.q);
  const results = await inParallel(jobs, async (j) => {
    const r = await chat(j.q, j.lang);
    const got = cites(r);
    const ok = twins.get(j.f.id).some((id) => got.includes(id));
    if (!ok) console.log(`  ✗ FAQ ${j.f.id} ${j.lang}: cited ${got.join(',') || '-'}`);
    return ok;
  });
  return { passed: results.filter(Boolean).length, total: results.length };
}

async function tapCheck() {
  const pick = (lang) => FAQS.filter((f) => f.audience === 'public').slice(0, QUICK ? 15 : undefined)
    .map((f) => ({ lang, q: lang === 'hi' ? f.q_hi : f.q_en }));
  const runs = await inParallel([...pick('en'), ...pick('hi')], async ({ lang, q }) => {
    const first = await chat(q, lang);
    const history = [{ role: 'user', content: q }, { role: 'assistant', content: first.reply }];
    const taps = [];
    for (const s of first.suggested_replies || []) {
      const r = await chat(s, lang, history, cites(first).slice(0, 4));
      if (isDeadEnd(r)) console.log(`  ✗ tap "${s}" after "${q.slice(0, 50)}": ${r.reply.slice(0, 80)}`);
      taps.push(isDeadEnd(r));
    }
    return taps;
  });
  const taps = runs.flat();
  return { dead: taps.filter(Boolean).length, total: taps.length };
}

async function caseCheck() {
  let passed = 0;
  for (const c of CASES) {
    const r = await chat(c.q, c.lang);
    let ok = c.ok(r);
    if (ok && c.then) {
      const history = [{ role: 'user', content: c.q }, { role: 'assistant', content: r.reply }];
      ok = c.then.ok(await chat(c.then.q, c.lang, history, cites(r)));
    }
    if (!ok) console.log(`  ✗ case "${c.q}": ${r.reply.slice(0, 120)}`);
    passed += ok;
  }
  return { passed, total: CASES.length };
}

(async () => {
  const t = Date.now();
  console.log(`Regression test against ${BASE_URL}${QUICK ? ' (quick)' : ''}`);
  const cases = await caseCheck();
  console.log(`Fixed cases:      ${cases.passed}/${cases.total}`);
  const faq = await faqCheck();
  console.log(`Official FAQs:    ${faq.passed}/${faq.total} cite the right FAQ`);
  const taps = await tapCheck();
  console.log(`Suggestion taps:  ${taps.dead}/${taps.total} dead ends`);
  const failures = [
    cases.passed < cases.total && 'fixed cases',
    faq.passed / faq.total < LIMITS.faqCorrect && `FAQs below ${LIMITS.faqCorrect * 100}%`,
    taps.dead / Math.max(taps.total, 1) > LIMITS.tapDeadEnds && `dead ends above ${LIMITS.tapDeadEnds * 100}%`,
  ].filter(Boolean);
  console.log(`\n${failures.length ? `FAIL: ${failures.join(', ')}` : 'PASS'} (${Math.round((Date.now() - t) / 1000)} s)`);
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
