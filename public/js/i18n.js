// UI strings for scripted flows, buttons, menus, consent and fallback replies (Hindi default, English).
// {placeholders} are filled by t(lang, key, vars).

const STRINGS = {
  hi: {
    langName: 'हिन्दी',
    bizNote: 'राज्य निर्वाचन आयोग, बिहार · हेल्प डेस्क (डेमो)। उत्तर आयोग के आधिकारिक FAQ और अधिनियमों से दिए जाते हैं।',
    consent: 'नमस्ते! 🙏 *{org}* के व्हाट्सऐप हेल्प डेस्क में आपका स्वागत है। पंचायत और नगरपालिका चुनाव से जुड़ी जानकारी के लिए। सूचनाएँ बंद करने के लिए कभी भी STOP लिखें।',
    chooseLang: 'अपनी भाषा चुनें / Choose your language:',
    howHelp: 'मैं आपकी क्या सहायता कर सकता हूँ? *विकल्प देखें* दबाएँ या अपना प्रश्न लिखें।',
    aiWelcome: 'नमस्ते! 🙏 मैं *{org}* का AI सहायक हूँ। पंचायत चुनाव, नगरपालिका चुनाव, ई-वोटिंग SECBHR ऐप, नामांकन, मतदाता सूची या पंचायत राज / नगरपालिका अधिनियम के बारे में कुछ भी पूछें।',
    viewOptions: 'विकल्प देखें',
    menuTitle: 'मुख्य मेन्यू',
    menuSection: 'चुनाव सेवाएँ',
    topicIntro: '*{topic}*: नीचे से प्रश्न चुनें या अपना प्रश्न लिखें।',
    officialsIntro: '*{topic}*: यह खंड निर्वाचन कर्मियों के लिए है (सॉफ़्टवेयर और वार्ड प्रविष्टि नियम)। प्रश्न चुनें या लिखें।',
    viewQuestions: 'प्रश्न देखें',
    moreQuestions: 'और प्रश्न…',
    moreQuestionsDesc: 'अगले प्रश्न देखें',
    complaintIntro: 'शिकायत: आप नई शिकायत दर्ज कर सकते हैं या पहले से दर्ज शिकायत की स्थिति देख सकते हैं।',
    complaintNew: 'शिकायत दर्ज करें',
    complaintStatus: 'स्थिति देखें',
    complaintHow: 'शिकायत कैसे करें?',
    complaintAsk: 'आपको हुई असुविधा के लिए खेद है। कृपया अपनी शिकायत एक संदेश में लिखें (जैसे: "मतदाता सूची में मेरा नाम गलत लिखा है")।',
    complaintDone: '📝 आपकी शिकायत दर्ज हो गई है।\nशिकायत संख्या: *{ticket}*\nस्थिति देखने के लिए यह संख्या यहाँ भेजें। (डेमो: यह नमूना संख्या है)',
    askComplaintRef: 'कृपया अपनी शिकायत संख्या भेजें (जैसे *CMP-2026-00412*)।',
    complaintInvalid: 'यह मान्य शिकायत संख्या नहीं लगती। प्रारूप *CMP-YYYY-NNNNN* है, जैसे CMP-2026-00412।',
    complaintNotFound: 'शिकायत संख्या *{ref}* नहीं मिली। कृपया संख्या जाँचें या अधिकारी से बात करें।',
    complaintFollow: 'स्थिति बदलने पर हम आपको यहीं सूचित करेंगे।',
    complaintLabels: { applicant: 'शिकायतकर्ता', category: 'विषय', updated: 'अद्यतन', next: 'कार्यालय' },
    statusNames: { review: 'जाँच में', approved: 'निस्तारित', pending: 'अतिरिक्त जानकारी आवश्यक', registered: 'दर्ज' },
    remindMe: 'मुझे सूचित करें',
    reminderSet: '✅ ठीक है! *{ref}* की स्थिति बदलने पर मैं आपको यहाँ संदेश भेजूँगा।',
    talkOfficer: 'अधिकारी से बात करें',
    mainMenu: 'मुख्य मेन्यू',
    docsIntro: 'आयोग से संबंधित अधिनियम (आधिकारिक PDF)। *दस्तावेज़ देखें* दबाएँ।',
    viewDocs: 'दस्तावेज़ देखें',
    docsTitle: 'अधिनियम और दस्तावेज़',
    docSent: 'यह रहा आपका दस्तावेज़। 📄',
    helpful: 'क्या यह जानकारी उपयोगी थी?',
    yes: 'हाँ 👍',
    no: 'नहीं 👎',
    thanksYes: 'आपकी प्रतिक्रिया के लिए धन्यवाद! 😊 कभी भी *मेन्यू* लिखें।',
    thanksNo: 'क्षमा करें। क्या आप किसी अधिकारी से बात करना चाहेंगे?',
    handover: 'आपको अधिकारी से जोड़ा जा रहा है। कृपया प्रतीक्षा करें, हेल्प-डेस्क अधिकारी शीघ्र ही यहाँ उत्तर देंगे। 🙋',
    handoverNote: 'चैट अधिकारी को स्थानांतरित की गई',
    officerJoined: 'अधिकारी रंजना (हेल्प डेस्क, रा.नि.आ. बिहार) चैट में जुड़ीं',
    officerName: 'अधिकारी रंजना',
    handoverEnd: 'अधिकारी ने यह बातचीत समाप्त कर दी है। मैं फिर से आपकी सहायता के लिए हूँ। 🤖',
    handoverEndNote: 'चैट AI सहायक को वापस',
    notifyTitle: 'शिकायत की स्थिति',
    notifyBody: 'अपडेट: आपकी शिकायत *{ref}* का *निस्तारण* कर दिया गया है। ✅ विवरण देखने के लिए नीचे दबाएँ।',
    notifyFooter: 'राज्य निर्वाचन आयोग, बिहार · सेवा सूचना (डेमो)',
    viewDetails: 'विवरण देखें',
    templateLabel: 'टेम्पलेट संदेश',
    optedOut: 'आपकी सदस्यता समाप्त कर दी गई है। अब आपको सूचनाएँ नहीं मिलेंगी। फिर से शुरू करने के लिए *START* लिखें।',
    optedIn: 'फिर से स्वागत है! आपको सेवा संदेश फिर से मिलेंगे। ✅',
    suppressed: 'सूचना नहीं भेजी गई: उपयोगकर्ता ने STOP किया है।',
    fallback: 'क्षमा करें, मैं अभी इसका उत्तर नहीं दे पा रहा हूँ। मैं आपको एक अधिकारी से जोड़ सकता हूँ।',
    pii: '⚠️ आपकी सुरक्षा के लिए इस चैट में आधार संख्या, पासवर्ड या OTP साझा न करें। शिकायत की स्थिति के लिए केवल शिकायत संख्या (CMP-YYYY-NNNNN) पर्याप्त है।',
    offlineNoMatch: 'मेरे पास अभी यह जानकारी नहीं है। क्या आप अधिकारी से बात करना चाहेंगे?',
    source: 'स्रोत',
    sourceFaq: 'आयोग के आधिकारिक FAQ',
    sourceAct: 'धारा',
    caseStudy: 'ई-वोटिंग केस स्टडी (नगर निकाय चुनाव 2025)',
    verifyNote: 'OCR / मशीन अनुवाद: आधिकारिक पाठ से मिलान करें',
    online: 'ऑनलाइन',
    typing: 'लिख रहे हैं…',
    placeholder: 'संदेश लिखें',
  },
  en: {
    langName: 'English',
    bizNote: 'State Election Commission, Bihar · Help desk (demo). Answers come from the Commission\'s official FAQs and Acts.',
    consent: 'Namaste! 🙏 Welcome to the WhatsApp help desk of the *{org}*, for Panchayat and Municipal election information. Reply STOP at any time to stop notifications.',
    chooseLang: 'अपनी भाषा चुनें / Choose your language:',
    howHelp: 'How can I help you today? Tap *View options* or just type your question.',
    aiWelcome: 'Namaste! 🙏 I am the AI assistant of the *{org}*. Ask me anything about Panchayat or Municipal elections, the eVoting SECBHR app, nominations, the voter list, or the Panchayat Raj / Municipal Acts.',
    viewOptions: 'View options',
    menuTitle: 'Main menu',
    menuSection: 'Election services',
    topicIntro: '*{topic}*: pick a question below or type your own.',
    officialsIntro: '*{topic}*: this section is for election officials (software and ward-entry rules). Pick or type a question.',
    viewQuestions: 'View questions',
    moreQuestions: 'More questions…',
    moreQuestionsDesc: 'See the next questions',
    complaintIntro: 'Complaints: register a new complaint or check the status of one you already filed.',
    complaintNew: 'Register complaint',
    complaintStatus: 'Check status',
    complaintHow: 'How to complain?',
    complaintAsk: 'Sorry you are facing an issue. Please describe it in one message (for example: "My name is misspelt in the voter list").',
    complaintDone: '📝 Your complaint is registered.\nComplaint no.: *{ticket}*\nSend this number here to check its status. (Demo: this is a sample number)',
    askComplaintRef: 'Please send your complaint number (for example *CMP-2026-00412*).',
    complaintInvalid: 'That does not look like a valid complaint number. The format is *CMP-YYYY-NNNNN*, e.g. CMP-2026-00412.',
    complaintNotFound: 'I could not find complaint *{ref}*. Please check the number, or talk to an officer.',
    complaintFollow: 'We will notify you here when the status changes.',
    complaintLabels: { applicant: 'Complainant', category: 'Subject', updated: 'Updated', next: 'Office' },
    statusNames: { review: 'Under review', approved: 'Resolved', pending: 'More details needed', registered: 'Registered' },
    remindMe: 'Notify me',
    reminderSet: '✅ Done! I will message you here when the status of *{ref}* changes.',
    talkOfficer: 'Talk to an officer',
    mainMenu: 'Main menu',
    docsIntro: 'Acts related to the Commission (official PDFs). Tap *View documents*.',
    viewDocs: 'View documents',
    docsTitle: 'Acts & documents',
    docSent: 'Here is your document. 📄',
    helpful: 'Was this helpful?',
    yes: 'Yes 👍',
    no: 'No 👎',
    thanksYes: 'Thank you for your feedback! 😊 Type *menu* any time.',
    thanksNo: 'Sorry about that. Would you like to talk to an officer?',
    handover: 'Connecting you to an officer. Please hold on, a help-desk officer will reply here shortly. 🙋',
    handoverNote: 'Chat transferred to an officer',
    officerJoined: 'Officer Ranjana (Help desk, SEC Bihar) joined the chat',
    officerName: 'Officer Ranjana',
    handoverEnd: 'The officer has closed this conversation. I am back to help you. 🤖',
    handoverEndNote: 'Chat returned to AI assistant',
    notifyTitle: 'Complaint status',
    notifyBody: 'Update: your complaint *{ref}* has been *Resolved*. ✅ Tap below for details.',
    notifyFooter: 'State Election Commission, Bihar · Service notification (demo)',
    viewDetails: 'View details',
    templateLabel: 'Template message',
    optedOut: 'You have been unsubscribed. You will not receive any more notifications. Reply *START* to subscribe again.',
    optedIn: 'Welcome back! You are subscribed to service messages again. ✅',
    suppressed: 'Notification suppressed: user has opted out (STOP).',
    fallback: "Sorry, I can't answer that right now. I can connect you to an officer.",
    pii: '⚠️ For your safety, please do not share Aadhaar numbers, passwords or OTPs in this chat. To check a complaint, the complaint number (CMP-YYYY-NNNNN) is enough.',
    offlineNoMatch: "I don't have that information right now. Would you like to talk to an officer?",
    source: 'Source',
    sourceFaq: 'Official SEC Bihar FAQ',
    sourceAct: 'Section',
    caseStudy: 'eVoting case study (ULB elections 2025)',
    verifyNote: 'OCR / machine translation: check the official text',
    online: 'online',
    typing: 'typing…',
    placeholder: 'Message',
  },
};

export const LANGS = ['hi', 'en'];

export function t(lang, key, vars = {}) {
  const table = STRINGS[lang] || STRINGS.hi;
  const value = key.split('.').reduce((o, k) => (o ? o[k] : undefined), table)
    ?? key.split('.').reduce((o, k) => (o ? o[k] : undefined), STRINGS.en);
  if (typeof value !== 'string') return value;
  return value.replace(/{(\w+)}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// FAQs carry both languages (q_hi/a_hi, q_en/a_en). Sub-points written "o ..." in the source become "◦ ...".
const tidy = (answer) => answer.replace(/\n\s*\n/g, '\n').replace(/^o\s+/gm, '   ◦ ');
export function faqText(lang, faq) {
  return lang === 'en' ? { question: faq.q_en, answer: tidy(faq.a_en) } : { question: faq.q_hi, answer: tidy(faq.a_hi) };
}

// Pick the Hindi or English field of a data row ({title, title_hi} style).
export function pick(lang, row, field) {
  return (lang === 'hi' && row[`${field}_hi`]) || row[field];
}

// Script of a typed message ('hi' for Devanagari), or null.
export function detectScript(text) {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  return null;
}
