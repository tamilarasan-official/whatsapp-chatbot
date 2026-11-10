// Knowledge gaps: questions the documents did not fully answer (answered from the website, partly, or not at
// all). Each is one JSON line on stdout ("[gap] {...}", visible in the Dokploy logs) and, when GAP_LOG_FILE
// is set, appended to that file (mount a volume there to keep it across deploys). Personal data is removed
// first. scripts/gap-report.js turns the log into the weekly report for the Commission.
const fs = require('fs');
const path = require('path');

const GAP_LOG_FILE = process.env.GAP_LOG_FILE || '';
const MAX_READ = 2000;

// Phone / Aadhaar / EPIC / ticket numbers, e-mail addresses and OTP-like codes never reach the log.
function scrub(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\b[A-Z]{3}\d{7}\b/gi, '<epic>')
    .replace(/\d[\d\s-]{5,}\d/g, '<number>')
    .slice(0, 300);
}

// The reply is a gap when it came from the website search, or the documents covered it only partly or not at all.
function isGap(result) {
  return ['faq', 'act', 'evoting', 'complaint'].includes(result.intent)
    && (result.route === 'web' || ['partial', 'none'].includes(result.coverage));
}

function record(message, result) {
  if (!isGap(result)) return;
  // A follow-up ("How to apply online?") is logged as the standalone question the search used.
  const rewritten = result.search?.rewritten || [];
  const standalone = rewritten[1] || rewritten[0];
  const entry = {
    at: new Date().toISOString(),
    lang: result.language,
    question: scrub(standalone || message),
    ...(standalone ? { asked: scrub(message) } : {}),
    route: result.route,
    coverage: result.route === 'web' ? 'website' : result.coverage,
    top_faq: result.search?.top_faq || null,
    top_section: result.search?.top_section || null,
    web: result.citations.filter((c) => c.type === 'web').map((c) => c.url),
  };
  const line = JSON.stringify(entry);
  console.log(`[gap] ${line}`);
  if (!GAP_LOG_FILE) return;
  fs.mkdir(path.dirname(GAP_LOG_FILE), { recursive: true }, () => {
    fs.appendFile(GAP_LOG_FILE, `${line}\n`, (err) => err && console.warn(`[gap] not saved: ${err.message}`));
  });
}

// The latest entries, newest last (for /api/admin/gaps).
function readRecent(limit = 500) {
  if (!GAP_LOG_FILE || !fs.existsSync(GAP_LOG_FILE)) return [];
  const lines = fs.readFileSync(GAP_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-Math.min(limit, MAX_READ)).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

module.exports = { record, readRecent, scrub, isGap };
