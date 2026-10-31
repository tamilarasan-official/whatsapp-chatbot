// Bot strings for WhatsApp (Hindi default, English). Mirrors public/js/i18n.js for the scripted flows,
// plus WhatsApp-only texts (returning user, numbered picks, media, officer queue). *bold* is WhatsApp markup.

const STRINGS = {
  hi: {
    langName: 'हिन्दी',
    consent: 'नमस्ते! 🙏 *{org}* के व्हाट्सऐप हेल्प डेस्क में आपका स्वागत है। पंचायत और नगरपालिका चुनाव से जुड़ी जानकारी के लिए। सूचनाएँ बंद करने के लिए कभी भी STOP लिखें।',
    chooseLang: 'अपनी भाषा चुनें / Choose your language:',
    welcomeBack: 'नमस्ते फिर से! 🙏 *{org}* हेल्प डेस्क। मैं आपकी क्या सहायता कर सकता हूँ? *विकल्प देखें* दबाएँ या अपना प्रश्न लिखें।',
    howHelp: 'मैं आपकी क्या सहायता कर सकता हूँ? *विकल्प देखें* दबाएँ या अपना प्रश्न लिखें।',
    viewOptions: 'विकल्प देखें',
    menuTitle: 'मुख्य मेन्यू',
    menuSection: 'चुनाव सेवाएँ',
    topicIntro: '*{topic}*: *प्रश्न देखें* दबाएँ, प्रश्न की संख्या भेजें, या अपना प्रश्न लिखें।',
    officialsIntro: '*{topic}*: यह खंड निर्वाचन कर्मियों के लिए है (सॉफ़्टवेयर और वार्ड प्रविष्टि नियम)। *प्रश्न देखें* दबाएँ या प्रश्न लिखें।',
    viewQuestions: 'प्रश्न देखें',
    moreQuestions: 'और प्रश्न…',
    moreQuestionsDesc: 'अगले प्रश्न देखें',
    whatNext: 'आगे क्या करना चाहेंगे?',
    complaintIntro: 'शिकायत: आप नई शिकायत दर्ज कर सकते हैं या पहले से दर्ज शिकायत की स्थिति देख सकते हैं।',
    complaintNew: 'शिकायत दर्ज करें',
    complaintStatus: 'स्थिति देखें',
    complaintHow: 'शिकायत कैसे करें?',
    complaintAsk: 'आपको हुई असुविधा के लिए खेद है। कृपया अपनी शिकायत एक संदेश में लिखें (जैसे: "मतदाता सूची में मेरा नाम गलत लिखा है")।',
    complaintDone: '📝 आपकी शिकायत दर्ज हो गई है।\nशिकायत संख्या: *{ticket}*\nस्थिति देखने के लिए यह संख्या यहाँ भेजें।',
    askComplaintRef: 'कृपया अपनी शिकायत संख्या भेजें (जैसे *CMP-2026-00412*)।',
    complaintInvalid: 'यह मान्य शिकायत संख्या नहीं लगती। प्रारूप *CMP-YYYY-NNNNN* है, जैसे CMP-2026-00412।',
    complaintNotFound: 'शिकायत संख्या *{ref}* नहीं मिली। कृपया संख्या जाँचें या अधिकारी से बात करें।',
    complaintFollow: 'स्थिति बदलने पर हम आपको यहीं सूचित करेंगे।',
    complaintCard: '📋 *शिकायत {ref}*\nस्थिति: *{status}*\nशिकायतकर्ता: {applicant}\nविषय: {category}\nअद्यतन: {updated}\nकार्यालय: {office}',
    complainantYou: 'आप',
    officeDefault: 'जिला निर्वाचन कार्यालय',
    statusNames: { review: 'जाँच में', approved: 'निस्तारित', pending: 'अतिरिक्त जानकारी आवश्यक', registered: 'दर्ज' },
    remindMe: 'मुझे सूचित करें',
    reminderSet: '✅ ठीक है! *{ref}* की स्थिति बदलने पर मैं आपको यहाँ संदेश भेजूँगा।',
    talkOfficer: 'अधिकारी से बात करें',
    mainMenu: 'मुख्य मेन्यू',
    docsIntro: 'आयोग से संबंधित अधिनियम (आधिकारिक PDF)। *दस्तावेज़ देखें* दबाएँ या संख्या भेजें।',
    viewDocs: 'दस्तावेज़ देखें',
    docsTitle: 'अधिनियम और दस्तावेज़',
    docSent: 'यह रहा आपका दस्तावेज़। 📄',
    helpful: 'क्या यह जानकारी उपयोगी थी?',
    yes: 'हाँ 👍',
    no: 'नहीं 👎',
    thanksYes: 'आपकी प्रतिक्रिया के लिए धन्यवाद! 😊 कभी भी *मेन्यू* लिखें।',
    thanksNo: 'क्षमा करें। क्या आप किसी अधिकारी से बात करना चाहेंगे?',
    handover: 'आपका अनुरोध हेल्प-डेस्क अधिकारी तक पहुँचा दिया गया है। 🙋 कार्य समय में अधिकारी यहीं उत्तर देंगे। बॉट पर लौटने के लिए कभी भी *मेन्यू* लिखें।',
    handoverWaiting: 'आपका संदेश अधिकारी को भेज दिया गया है। कृपया प्रतीक्षा करें। बॉट पर लौटने के लिए *मेन्यू* लिखें।',
    handoverEnd: 'अधिकारी ने यह बातचीत समाप्त कर दी है। मैं फिर से आपकी सहायता के लिए हूँ। 🤖',
    officerPrefix: '👤 *हेल्प-डेस्क अधिकारी:*',
    notifyBody: 'अपडेट: आपकी शिकायत *{ref}* की स्थिति अब *{status}* है। विवरण देखने के लिए नीचे दबाएँ।',
    viewDetails: 'विवरण देखें',
    optedOut: 'आपकी सदस्यता समाप्त कर दी गई है। अब आपको सूचनाएँ नहीं मिलेंगी। फिर से शुरू करने के लिए *START* लिखें।',
    optedIn: 'फिर से स्वागत है! आपको सेवा संदेश फिर से मिलेंगे। ✅',
    fallback: 'क्षमा करें, मैं अभी इसका उत्तर नहीं दे पा रहा हूँ। मैं आपको एक अधिकारी से जोड़ सकता हूँ।',
    pii: '⚠️ आपकी सुरक्षा के लिए इस चैट में आधार संख्या, पासवर्ड या OTP साझा न करें। शिकायत की स्थिति के लिए केवल शिकायत संख्या (CMP-YYYY-NNNNN) पर्याप्त है।',
    unsupported: 'क्षमा करें, मैं अभी केवल लिखित संदेश पढ़ सकता हूँ। कृपया अपना प्रश्न लिखकर भेजें, या *मेन्यू* लिखें।',
    slowDown: 'कृपया थोड़ा धीरे। 🙏 एक मिनट बाद फिर संदेश भेजें।',
    source: '📌 स्रोत',
    sourceFaq: 'आयोग के आधिकारिक FAQ',
    sourceAct: 'धारा',
    caseStudy: 'ई-वोटिंग केस स्टडी (नगर निकाय चुनाव 2025)',
    verifyNote: 'OCR / मशीन अनुवाद: आधिकारिक पाठ से मिलान करें',
    moreSources: '+{n} अन्य स्रोत',
    today: 'आज',
  },
  en: {
    langName: 'English',
    consent: 'Namaste! 🙏 Welcome to the WhatsApp help desk of the *{org}*, for Panchayat and Municipal election information. Reply STOP at any time to stop notifications.',
    chooseLang: 'अपनी भाषा चुनें / Choose your language:',
    welcomeBack: 'Welcome back! 🙏 *{org}* help desk. How can I help you today? Tap *View options* or type your question.',
    howHelp: 'How can I help you today? Tap *View options* or just type your question.',
    viewOptions: 'View options',
    menuTitle: 'Main menu',
    menuSection: 'Election services',
    topicIntro: '*{topic}*: tap *View questions*, send a question number, or type your own question.',
    officialsIntro: '*{topic}*: this section is for election officials (software and ward-entry rules). Tap *View questions* or type a question.',
    viewQuestions: 'View questions',
    moreQuestions: 'More questions…',
    moreQuestionsDesc: 'See the next questions',
    whatNext: 'What would you like to do next?',
    complaintIntro: 'Complaints: register a new complaint or check the status of one you already filed.',
    complaintNew: 'Register complaint',
    complaintStatus: 'Check status',
    complaintHow: 'How to complain?',
    complaintAsk: 'Sorry you are facing an issue. Please describe it in one message (for example: "My name is misspelt in the voter list").',
    complaintDone: '📝 Your complaint is registered.\nComplaint no.: *{ticket}*\nSend this number here to check its status.',
    askComplaintRef: 'Please send your complaint number (for example *CMP-2026-00412*).',
    complaintInvalid: 'That does not look like a valid complaint number. The format is *CMP-YYYY-NNNNN*, e.g. CMP-2026-00412.',
    complaintNotFound: 'I could not find complaint *{ref}*. Please check the number, or talk to an officer.',
    complaintFollow: 'We will notify you here when the status changes.',
    complaintCard: '📋 *Complaint {ref}*\nStatus: *{status}*\nComplainant: {applicant}\nSubject: {category}\nUpdated: {updated}\nOffice: {office}',
    complainantYou: 'You',
    officeDefault: 'District Election Office',
    statusNames: { review: 'Under review', approved: 'Resolved', pending: 'More details needed', registered: 'Registered' },
    remindMe: 'Notify me',
    reminderSet: '✅ Done! I will message you here when the status of *{ref}* changes.',
    talkOfficer: 'Talk to an officer',
    mainMenu: 'Main menu',
    docsIntro: 'Acts related to the Commission (official PDFs). Tap *View documents* or send a number.',
    viewDocs: 'View documents',
    docsTitle: 'Acts & documents',
    docSent: 'Here is your document. 📄',
    helpful: 'Was this helpful?',
    yes: 'Yes 👍',
    no: 'No 👎',
    thanksYes: 'Thank you for your feedback! 😊 Type *menu* any time.',
    thanksNo: 'Sorry about that. Would you like to talk to an officer?',
    handover: 'Your request has been passed to a help-desk officer. 🙋 An officer will reply here during working hours. Type *menu* any time to return to the assistant.',
    handoverWaiting: 'Your message has been forwarded to the officer. Please wait. Type *menu* to return to the assistant.',
    handoverEnd: 'The officer has closed this conversation. I am back to help you. 🤖',
    officerPrefix: '👤 *Help-desk officer:*',
    notifyBody: 'Update: the status of your complaint *{ref}* is now *{status}*. Tap below for details.',
    viewDetails: 'View details',
    optedOut: 'You have been unsubscribed. You will not receive any more notifications. Reply *START* to subscribe again.',
    optedIn: 'Welcome back! You are subscribed to service messages again. ✅',
    fallback: "Sorry, I can't answer that right now. I can connect you to an officer.",
    pii: '⚠️ For your safety, please do not share Aadhaar numbers, passwords or OTPs in this chat. To check a complaint, the complaint number (CMP-YYYY-NNNNN) is enough.',
    unsupported: 'Sorry, I can only read text messages at the moment. Please type your question, or type *menu*.',
    slowDown: 'Please slow down a little. 🙏 Try again in a minute.',
    source: '📌 Source',
    sourceFaq: 'Official SEC Bihar FAQ',
    sourceAct: 'Section',
    caseStudy: 'eVoting case study (ULB elections 2025)',
    verifyNote: 'OCR / machine translation: check the official text',
    moreSources: '+{n} more',
    today: 'Today',
  },
};

const LANGS = ['hi', 'en'];

function t(lang, key, vars = {}) {
  const table = STRINGS[lang] || STRINGS.hi;
  const get = (tbl) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), tbl);
  const value = get(table) ?? get(STRINGS.en);
  if (typeof value !== 'string') return value;
  return value.replace(/{(\w+)}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// Official FAQ text in the user's language (English when the language has no version). "o ..." sub-points become "◦".
const tidy = (answer) => answer.replace(/\n\s*\n/g, '\n').replace(/^o\s+/gm, '   ◦ ');
function faqText(lang, faq) {
  const l = lang !== 'en' && faq[`q_${lang}`] && faq[`a_${lang}`] ? lang : 'en';
  return { question: faq[`q_${l}`], answer: tidy(faq[`a_${l}`]) };
}

// Field of a data row in the UI language ({title, title_hi} style), English as fallback.
const pick = (lang, row, field) => (lang !== 'en' && row[`${field}_${lang}`]) || row[field];

// 'hi' when the message is written in Devanagari, else null.
const detectScript = (text) => (/[ऀ-ॿ]/.test(text) ? 'hi' : null);

module.exports = { STRINGS, LANGS, t, faqText, pick, detectScript };
