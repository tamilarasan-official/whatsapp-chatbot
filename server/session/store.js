// Per-phone sessions for the WhatsApp bot.
//   - Conversation state (step, history, handover, last list shown) lives in memory and is reset after
//     SESSION_TTL_MIN of silence. Transcripts are never written to disk.
//   - The small "profile" that must survive restarts (language, STOP opt-out, consent time, complaints
//     registered here, reminders) is persisted to <STATE_DIR>/whatsapp-profiles.json: STOP is a legal
//     requirement and must not be forgotten on redeploy. Swap this file for Redis/Postgres in production
//     by implementing load()/persist() only.
const fs = require('fs');
const path = require('path');

const FILE = 'whatsapp-profiles.json';
const PROFILE_KEYS = ['lang', 'optedOut', 'consentAt', 'complaints', 'reminders', 'statusOverrides', 'lastInboundAt', 'name'];
const MAX_HISTORY = 40;
const WRITE_DELAY_MS = 300;

function conversationFields() {
  return {
    started: false, step: null, handover: false, handoverAt: null, handoverNoticeAt: null, handoverReason: null,
    audience: null, lastComplaint: null, lastTicket: null, lastIntent: null,
    history: [], lastChoices: [], lastBotAt: null, resumed: false,
  };
}

function newSession(phone, profile = {}) {
  return {
    phone, name: '', lang: null, optedOut: false, consentAt: null,
    complaints: {}, reminders: [], statusOverrides: {}, lastInboundAt: null,
    ...profile,
    ...conversationFields(),
  };
}

class SessionStore {
  constructor({ dir, ttlMs = 24 * 60 * 60 * 1000, persist = true, now = Date.now, defaultLang = 'hi' } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.persist = persist && Boolean(dir);
    this.now = now;
    this.defaultLang = defaultLang;
    this.sessions = new Map();
    this.data = { version: 1, complaintSeq: 431, profiles: {} };
    this.timer = null;
    if (this.persist) this.load();
  }

  get file() { return path.join(this.dir, FILE); }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.profiles) this.data = { ...this.data, ...raw };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[session] could not read ${this.file}: ${err.message}`);
    }
  }

  // Atomic write (tmp + rename), debounced so a burst of messages causes one write.
  schedulePersist() {
    if (!this.persist || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, WRITE_DELAY_MS);
  }

  flush() {
    if (!this.persist) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[session] could not write ${this.file}: ${err.message}`);
    }
  }

  // The session for a phone: in memory, else rebuilt from its stored profile, else new.
  // A conversation silent for longer than the TTL starts over (profile kept, so language and STOP survive).
  get(phone) {
    let s = this.sessions.get(phone);
    if (!s) {
      s = newSession(phone, this.data.profiles[phone]);
      this.sessions.set(phone, s);
    }
    if (s.started && s.lastInboundAt && this.now() - s.lastInboundAt > this.ttlMs) {
      Object.assign(s, conversationFields(), { resumed: true });
    }
    return s;
  }

  peek(phone) { return this.sessions.get(phone) || null; }

  save(session) {
    session.history = session.history.slice(-MAX_HISTORY);
    const profile = {};
    for (const k of PROFILE_KEYS) profile[k] = session[k];
    this.data.profiles[session.phone] = profile;
    this.schedulePersist();
  }

  nextComplaintSeq() {
    this.data.complaintSeq += 1;
    this.schedulePersist();
    return this.data.complaintSeq;
  }

  // Sessions currently waiting for an officer (for the admin endpoint).
  handovers() {
    return [...this.sessions.values()].filter((s) => s.handover)
      .map((s) => ({ phone: s.phone, name: s.name, lang: s.lang, since: s.handoverAt, reason: s.handoverReason, lastInboundAt: s.lastInboundAt }));
  }

  // Drop idle conversations from memory (profiles stay on disk).
  sweep() {
    const cutoff = this.now() - this.ttlMs;
    for (const [phone, s] of this.sessions) if ((s.lastInboundAt || 0) < cutoff && !s.handover) this.sessions.delete(phone);
  }
}

module.exports = { SessionStore, MAX_HISTORY };
