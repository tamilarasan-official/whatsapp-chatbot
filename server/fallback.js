const FALLBACK_REPLIES = {
  en: "Sorry, I can't answer that right now. Let me connect you to an officer who can help.",
  hi: 'क्षमा करें, मैं अभी इसका उत्तर नहीं दे पा रहा हूँ। मैं आपको एक अधिकारी से जोड़ देता हूँ।',
};

const OFFICER_LABEL = { en: 'Talk to an officer', hi: 'अधिकारी से बात करें' };

function fallbackReply(language, reason) {
  const lang = FALLBACK_REPLIES[language] ? language : 'hi';
  return {
    reply: FALLBACK_REPLIES[lang],
    language: lang,
    intent: 'handover',
    confidence: 0,
    sources: [],
    escalate: false,
    action: 'none',
    suggested_replies: [OFFICER_LABEL[lang]],
    fallback: true,
    reason: reason || 'unknown',
  };
}

module.exports = { fallbackReply, FALLBACK_REPLIES };
