// Sends sample questions to /api/chat and prints intent, language, confidence and latency.
// Usage: npm run test:ai   (server must be running; BASE_URL defaults to http://localhost:3000)

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const QUESTIONS = [
  { message: 'Which documents do I need to apply?', language: 'en', expect: 'faq' },
  { message: 'Who is eligible to apply?', language: 'en', expect: 'faq' },
  { message: 'What is the application fee amount?', language: 'en', expect: 'out_of_scope (no invented number)' },
  { message: 'What is the weather in Paris?', language: 'en', expect: 'out_of_scope' },
  { message: 'Who will win the match today?', language: 'en', expect: 'out_of_scope' },
  { message: 'आवेदन की अंतिम तिथि क्या है?', language: 'hi', expect: 'faq / hi' },
  { message: 'அலுவலக நேரம் என்ன?', language: 'ta', expect: 'faq / ta' },
  { message: 'mujhe scholarship ke baare mein batao', language: 'en', expect: 'faq / mixed' },
  { message: 'This is useless, I want to speak to a real person now!', language: 'en', expect: 'handover, escalate' },
  { message: 'How do I correct a mistake in my application?', language: 'en', expect: 'faq' },
];

async function ask(q) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q.message, history: [], language: q.language }),
    });
    const data = await res.json();
    return { status: res.status, data, ms: Date.now() - started };
  } catch (err) {
    return { status: 0, data: { reply: err.message }, ms: Date.now() - started };
  }
}

async function main() {
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error(`Server not reachable at ${BASE_URL}. Run "npm start" first.`);
    process.exit(1);
  }
  console.log(`Model: ${health.model} | KB items: ${health.kbItems} | AI configured: ${health.aiConfigured}\n`);

  let failures = 0;
  for (const [i, q] of QUESTIONS.entries()) {
    const { status, data, ms } = await ask(q);
    if (status !== 200) failures += 1;
    console.log(`${String(i + 1).padStart(2)}. ${q.message}`);
    console.log(`    expect: ${q.expect}`);
    console.log(`    got:    HTTP ${status} | intent=${data.intent} lang=${data.language} conf=${data.confidence} escalate=${data.escalate} sources=${JSON.stringify(data.sources)} | ${data.latency_ms ?? ms} ms${data.fallback ? ' | FALLBACK' : ''}`);
    console.log(`    reply:  ${String(data.reply).replace(/\s+/g, ' ')}\n`);
  }
  console.log(failures ? `${failures} request(s) did not return 200.` : 'All requests returned 200.');
  process.exit(failures ? 1 : 0);
}

main();
