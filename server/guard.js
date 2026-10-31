// Deterministic neutrality guard, applied before retrieval and the model.
// The prompt already forbids political opinions, but the model occasionally misreads Hindi / Hinglish
// phrasings ("कौन सी पार्टी को वोट दूँ?") as unclear. Vote advice, predictions and party comparisons are
// answered with a fixed neutral reply instead. Legitimate questions that merely mention parties or symbols
// ("can candidates contest on a party symbol?") must NOT match, so the patterns need the advice/prediction shape.
const POLITICAL = [
  /(किस|कौन\s*सी|कौन|कौन\s*से)\s*(पार्टी|दल|उम्मीदवार|प्रत्याशी|नेता)\s*(को|के\s*लिए)?\s*(वोट|मत)/,
  /(वोट|मत)\s*(किसे|किसको|किस\s*को|कहाँ|कहां)\s*(दूँ|दूं|दें|दे|डालूँ|डालूं|करूँ|करूं)/,
  // "किसे वोट दें?" (advice), but not "किसे वोट देने का अधिकार है" (who has the right to vote)
  /(किसे|किसको|किस\s*को)\s*(वोट|मत)\s*(दूँ|दूं|दें|करूँ|करूं|डालूँ|डालूं)(?![\p{L}\p{M}])/u, // \b is ASCII-only in JS
  /(कौन|कौन\s*सी|किसकी)\s*(पार्टी|दल|उम्मीदवार|प्रत्याशी)?\s*(जीतेगा|जीतेगी|जीतेंगे|जीत\s*रही|जीत\s*रहा|बनेगी\s*सरकार)/,
  /\b(kis|kaun\s*si|kaunsi|konsi|kon\s*si|kaun|kon)\s*(party|dal|candidate|neta|ummeedwar|pratyashi)\s*(ko)?\s*(vote|mat)\b/i,
  /\b(vote|mat)\s*(kise|kisko|kis\s*ko|kahan)\s*(du|doon|dun|de|dein|dalu|dalun|karu|karun)\b/i,
  /\b(kaun|kon|kiski)\s*(party|dal)?\s*(jeetega|jitega|jeetegi|jitegi)\b/i,
  /\b(which|what)\s+(party|candidate|leader)\s+(should|to|do i|shall|would|will|is (the )?best)/i,
  /\b(who|whom)\s+(should|shall|do)\s+(i|we)\s+vote\b|\bwho\s+to\s+vote\s+for\b|\bvote\s+for\s+whom\b/i,
  /\b(who|which\s+party)\s+(will|is going to|would)\s+win\b|\b(best|worst)\s+(party|candidate)\b/i,
  /\b(bjp|congress|rjd|jd\s*\(?u\)?|jdu|ljp|aap|nda|india alliance|mahagathbandhan)\b.{0,30}\b(better|best|worst|good|bad|support|vote|win|jeet)/i,
  /(भाजपा|कांग्रेस|राजद|जदयू|लोजपा|महागठबंधन|एनडीए).{0,30}(अच्छी|अच्छा|बेहतर|खराब|समर्थन|वोट|जीत)/,
];

const NEUTRAL = {
  hi: 'मैं किसी पार्टी, उम्मीदवार या नेता के बारे में राय नहीं दे सकता और न ही चुनाव परिणाम का अनुमान लगा सकता हूँ। 🙏 मतदान आपका अपना निर्णय है। मैं पंचायत और नगरपालिका चुनाव की प्रक्रिया, मतदाता सूची, नामांकन या ई-वोटिंग के बारे में जानकारी दे सकता हूँ।',
  en: 'I cannot give an opinion on any party, candidate or leader, or predict election results. 🙏 Whom to vote for is your own decision. I can help with the Panchayat and Municipal election process, the voter list, nominations or eVoting.',
  mixed: 'Main kisi party, candidate ya neta ke baare mein raay nahi de sakta, aur na hi result ka anumaan laga sakta hoon. 🙏 Vote kise dena hai yeh aapka apna faisla hai. Main Panchayat / Municipal election process, voter list, nomination ya eVoting ke baare mein bata sakta hoon.',
};

const isPolitical = (message) => POLITICAL.some((re) => re.test(message));

// A complete answer-engine result for a political message, or null.
function politicalReply(message, lang) {
  if (!isPolitical(message)) return null;
  const l = NEUTRAL[lang] ? lang : 'hi';
  return {
    reply: NEUTRAL[l], language: l, intent: 'out_of_scope', confidence: 0.98, escalate: false, action: 'none',
    suggested_replies: [], sources: [], citations: [], route: 'guard', search: { rewritten: [], top_faq: null, top_section: null, retrieval_route: 'guard' },
  };
}

module.exports = { isPolitical, politicalReply, NEUTRAL };
