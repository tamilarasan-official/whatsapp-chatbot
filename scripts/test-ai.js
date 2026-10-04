// Sends sample questions (static and AI mode) to /api/chat and prints intent, language, confidence and latency.
// Usage: npm run test:ai   (server must be running; BASE_URL defaults to http://localhost:3000)

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const QUESTIONS = [
  { message: 'Which documents do I need for Form 6?', language: 'en', expect: 'faq, grounded' },
  { message: 'hi, how are you?', language: 'en', expect: 'smalltalk, natural reply' },
  { message: 'When is the next election in Tamil Nadu?', language: 'en', expect: 'no invented date' },
  { message: 'Which party should I vote for?', language: 'en', expect: 'out_of_scope, neutral' },
  { message: 'What is the weather in Delhi?', language: 'en', expect: 'out_of_scope' },
  { message: 'मतदाता सूची में अपना नाम कैसे देखें?', language: 'hi', expect: 'faq / hi' },
  { message: 'வாக்குச்சாவடியில் எந்த அடையாள அட்டை காட்டலாம்?', language: 'ta', expect: 'faq / ta' },
  { message: 'voter id kaise download kare?', language: 'en', expect: 'faq / mixed' },
  { message: 'This is useless, I want to speak to a real person now!', language: 'en', expect: 'handover, escalate' },
  { message: 'I want to book a visit to the voter office', language: 'en', expect: 'action=appointment' },
  { message: 'I moved from Delhi to Chennai, what about my voter ID?', language: 'en', mode: 'ai', expect: 'AI mode: Form 8, action=none' },
  { message: 'My application is REF-2026-10454, what is pending?', language: 'en', mode: 'ai', expect: 'AI mode: uses record (address proof)' },
];

async function ask(q) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q.message, history: [], language: q.language, mode: q.mode || 'static' }),
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
    console.log(`${String(i + 1).padStart(2)}. [${q.mode || 'static'}] ${q.message}`);
    console.log(`    expect: ${q.expect}`);
    console.log(`    got:    HTTP ${status} | intent=${data.intent} lang=${data.language} conf=${data.confidence} escalate=${data.escalate} action=${data.action} sources=${JSON.stringify(data.sources)} | ${data.latency_ms ?? ms} ms${data.fallback ? ' | FALLBACK' : ''}`);
    console.log(`    reply:  ${String(data.reply).replace(/\s+/g, ' ')}\n`);
  }
  console.log(failures ? `${failures} request(s) did not return 200.` : 'All requests returned 200.');
  process.exit(failures ? 1 : 0);
}

main();
