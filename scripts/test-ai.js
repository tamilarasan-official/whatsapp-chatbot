// Sends sample SEC Bihar questions to /api/chat and prints route, citations, language, latency and the reply.
// Usage: npm run test:ai   (server must be running; BASE_URL defaults to http://localhost:3000)
//        node scripts/test-ai.js --brief   (one line per question)

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BRIEF = process.argv.includes('--brief');

// `then` = a follow-up sent with the previous turn as history.
const QUESTIONS = [
  { message: 'नामांकन के समय कार्यालय के पास वाहन ले जा सकते हैं?', expect: 'faq municipal_01, hi' },
  { message: 'How can I vote using the eVoting app?', language: 'en', expect: 'faq evoting, en' },
  { message: 'evoting app me registration kaise kare?', expect: 'faq evoting, Hinglish reply' },
  { message: 'ग्राम पंचायत का कार्यकाल कितने वर्ष का होता है?', expect: 'act panchayat_act:14, cited' },
  { message: 'What does section 125 of the municipal act say?', language: 'en', expect: 'lookup municipal_act:125' },
  { message: 'पंचायत राज अधिनियम की धारा 14 क्या है?', expect: 'lookup panchayat_act:14' },
  { message: 'Who can contest for the post of Mukhiya?', language: 'en', expect: 'act, cited' },
  { message: 'Mukhiya ka chunav kaun lad sakta hai?', expect: 'act, Hinglish', then: 'aur umar kitni honi chahiye?' },
  { message: 'Which party should I vote for in the panchayat election?', language: 'en', expect: 'out_of_scope, neutral' },
  { message: 'When is the next panchayat election in Bihar?', language: 'en', expect: 'no invented date' },
  { message: 'How do I get a new voter ID card?', language: 'en', expect: 'ECI redirect (voters.eci.gov.in / 1950)' },
  { message: 'आज पटना का मौसम कैसा है?', expect: 'out_of_scope, hi' },
  { message: 'hello, who are you?', language: 'en', expect: 'smalltalk' },
  { message: 'This is useless, connect me to a real person!', language: 'en', expect: 'handover, escalate' },
  { message: 'How was data security handled in the Bihar eVoting system?', language: 'en', mode: 'ai', expect: 'case study, cited' },
];

async function ask(message, history, q) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, language: q.language || 'hi', mode: q.mode || 'static' }),
    });
    return { status: res.status, data: await res.json(), ms: Date.now() - started };
  } catch (err) {
    return { status: 0, data: { reply: err.message, citations: [] }, ms: Date.now() - started };
  }
}

function print(message, r, expect) {
  const d = r.data;
  const cites = (d.citations || []).map((c) => (c.type === 'faq' ? c.faq_id : `${c.key}${c.reliability !== 'high' ? `(${c.reliability})` : ''}`)).join(', ') || '-';
  console.log(`\n> ${message}${expect ? `   [expect: ${expect}]` : ''}`);
  console.log(`  ${r.status} ${d.route || '-'} | ${d.intent}/${d.action} | ${d.language} | conf ${d.confidence} | cites ${cites}`
    + `${d.escalate ? ' | escalate' : ''}${d.fallback ? ' | FALLBACK' : ''} | ${r.ms} ms`);
  if (d.search?.rewritten?.length) console.log(`  rewritten: ${d.search.rewritten.join(' / ')}`);
  if (!BRIEF) console.log(`  ${String(d.reply).replace(/\n/g, '\n  ')}`);
}

async function main() {
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error(`Server not reachable at ${BASE_URL}. Run "npm start" first.`);
    process.exit(1);
  }
  console.log(`Server OK | model ${health.model} | KB ${health.kb.faqs} FAQs, ${health.kb.sections} sections | AI ${health.aiConfigured ? 'on' : 'off'}`);
  for (const q of QUESTIONS) {
    const r = await ask(q.message, [], q);
    print(q.message, r, q.expect);
    if (q.then) {
      const history = [{ role: 'user', content: q.message }, { role: 'assistant', content: r.data.reply }];
      print(q.then, await ask(q.then, history, q), 'follow-up uses history');
    }
  }
}

main();
