"""Phase 2 - Hand-written evaluation set (the answer key) for retrieval and the FAQ matcher.

Types:
  faq  - paraphrases of a client FAQ (English / Hindi / Hinglish); gold = that FAQ (or an identical one)
  act  - questions answered by a specific Act section; gold = "family:section" (EN or HI version both count)
  case - questions answered by the eVoting case study; gold = case-study entry ids
  oos  - out of scope (politics, weather, other services, chit-chat); gold = no FAQ match

Split: 70% dev (tuning) / 30% test (final scores), deterministic per question.
Output: data/kb/eval/questions.json
"""
import hashlib
import json
from common import OUT

# ---- FAQ paraphrases: id -> [(lang, text)] ; en / hi / hl (Hinglish) ----
FAQ = {
    'municipal_01': [('en', 'Are EVMs used in municipal elections?'), ('en', 'can one person contest for more than one post in nagar nikay election'),
                     ('hi', 'नगरपालिका चुनाव में ईवीएम का इस्तेमाल होता है क्या?'), ('hi', 'क्या एक व्यक्ति एक से ज्यादा पद के लिए नामांकन कर सकता है?'),
                     ('hl', 'nagar nigam chunav me EVM se voting hoti hai kya')],
    'municipal_02': [('en', 'who is allowed inside the counting hall'), ('en', 'is mobile phone allowed in counting room'),
                     ('hi', 'मतगणना कक्ष में कौन जा सकता है?'), ('hi', 'क्या मतगणना केंद्र में मोबाइल ले जा सकते हैं?'),
                     ('hl', 'counting room me kaun kaun ja sakta hai')],
    'municipal_03': [('en', 'how is the result taken out from the EVM'), ('en', 'EVM result button counting procedure'),
                     ('hi', 'ईवीएम से रिजल्ट कैसे निकाला जाता है?'), ('hl', 'EVM se result kaise pata chalta hai')],
    'municipal_04': [('en', 'can a blind voter take a helper to vote'), ('en', 'oath taking of newly elected councillors'),
                     ('hi', 'दृष्टिहीन मतदाता को वोट डालने में कौन मदद कर सकता है?'), ('hi', 'नवनिर्वाचित पार्षद शपथ कैसे लेते हैं?'),
                     ('hl', 'andhe voter ke saath sahayak ja sakta hai kya')],
    'municipal_05': [('en', 'who can contest the municipal election'), ('en', 'how to file nomination for ward councillor'),
                     ('hi', 'नगरपालिका चुनाव में नामांकन कौन कर सकता है?'), ('hi', 'नामांकन पत्र कैसे दाखिल करें?'),
                     ('hl', 'ward parshad ke liye nomination kaise file kare')],
    'municipal_06': [('en', 'what documents are needed with the nomination paper'), ('en', 'what is an affidavit in nomination'),
                     ('hi', 'नामांकन के समय कौन से कागजात चाहिए?'), ('hi', 'शपथ पत्र क्या होता है?'),
                     ('hl', 'nomination ke time kaun se documents lagte hai')],
    'municipal_07': [('en', 'when is scrutiny of nomination papers done'), ('en', 'can I withdraw my nomination'),
                     ('hi', 'नाम वापसी की प्रक्रिया क्या है?'), ('hi', 'नामांकन पत्रों की जांच कब होती है?'),
                     ('hl', 'nomination wapas kaise le')],
    'municipal_08': [('en', 'how are election symbols given to candidates'), ('en', 'free symbol allotment guidelines'),
                     ('hi', 'चुनाव चिन्ह कैसे आवंटित होते हैं?'), ('hl', 'chunav chinh kaise milta hai')],
    'municipal_09': [('en', 'what is candidate suvidha portal'), ('en', 'benefits of the online portal for candidates'),
                     ('hi', 'कैंडिडेट सुविधा पोर्टल क्या है?'), ('hl', 'candidate suvidha portal ka kya fayda hai')],
    'municipal_10': [('en', 'can candidates paste posters on government buildings'), ('en', 'rules on wall writing during election'),
                     ('hi', 'चुनाव में दीवार लेखन और पोस्टर लगाने के नियम क्या हैं?'), ('hl', 'sarkari building par poster laga sakte hai kya')],
    'municipal_11': [('en', 'what is the model code of conduct'), ('en', 'when does the code of conduct start'),
                     ('hi', 'आदर्श आचार संहिता क्या है?'), ('hi', 'आचार संहिता कब से लागू होती है?'),
                     ('hl', 'aachar sanhita kab lagu hoti hai')],
    'municipal_12': [('en', 'who is the returning officer'), ('en', 'role of assistant returning officer'),
                     ('hi', 'निर्वाची पदाधिकारी कौन होता है?'), ('hl', 'RO aur ARO kaun hote hai')],
    'municipal_13': [('en', 'what does an election observer do'), ('en', 'observer duties in election'),
                     ('hi', 'चुनाव प्रेक्षक की क्या भूमिका होती है?'), ('hl', 'chunav observer ka kaam kya hai')],
    'municipal_14': [('en', 'where can I see election notifications'), ('en', 'where are SEC election notices published'),
                     ('hi', 'चुनाव से जुड़ी अधिसूचनाएं कहाँ देखें?'), ('hl', 'election notification kaha milega')],
    'municipal_15': [('en', 'how to check my name in the voter list'), ('en', 'find my polling station'),
                     ('hi', 'मतदाता सूची में अपना नाम कैसे देखें?'), ('hi', 'मेरा मतदान केंद्र कहाँ है कैसे पता करूं?'),
                     ('hl', 'voter list me naam kaise check kare')],
    'municipal_16': [('en', 'how to use the matdata suvidha app'), ('en', 'voter facilitation app features'),
                     ('hi', 'मतदाता सुविधा ऐप का उपयोग कैसे करें?'), ('hl', 'matdata suvidha app kaise use kare')],
    'municipal_17': [('en', 'what is the voter helpline number'), ('en', 'how to contact the election helpline'),
                     ('hi', 'मतदाता हेल्पलाइन नंबर क्या है?'), ('hl', 'helpline number kya hai')],
    'municipal_18': [('en', 'how to file an objection to the voter list'), ('en', 'what are claims and objections'),
                     ('hi', 'दावा और आपत्ति कहाँ दर्ज करें?'), ('hl', 'voter list par aapatti kaise kare')],
    'municipal_19': [('en', 'what is ward delimitation'), ('en', 'how are wards formed'),
                     ('hi', 'वार्ड गठन और परिसीमन क्या है?'), ('hl', 'ward parisiman kya hota hai')],
    'municipal_20': [('en', 'where to see the list of contesting candidates'), ('en', 'who won in my ward'),
                     ('hi', 'जीते हुए प्रत्याशियों की जानकारी कहाँ मिलेगी?'), ('hl', 'winning candidate ki list kaha dekhe')],
    'municipal_21': [('en', 'how do I file an election complaint'), ('en', 'check status of my complaint'),
                     ('hi', 'चुनाव से जुड़ी शिकायत कैसे करें?'), ('hl', 'complaint ka status kaise check kare')],
    'municipal_22': [('en', 'permission for LED van campaign'), ('en', 'can I use an LED bike for campaigning'),
                     ('hi', 'एलईडी वैन से प्रचार की अनुमति कैसे लें?'), ('hl', 'LED van prachar permission kaise milega')],
    'municipal_23': [('en', 'what is e-voting'), ('en', 'meaning of online voting from mobile'),
                     ('hi', 'ई-वोटिंग क्या है?'), ('hl', 'e voting kya hai')],
    'municipal_24': [('en', 'who is eligible for e-voting'), ('en', 'can migrant workers use e-voting'),
                     ('hi', 'ई-वोटिंग सुविधा का लाभ कौन ले सकता है?'), ('hl', 'e voting kaun kar sakta hai')],
    'municipal_25': [('en', 'online election service website not working what to do'), ('en', 'technical issue with online election service'),
                     ('hi', 'ऑनलाइन चुनाव सेवा में तकनीकी समस्या हो तो क्या करें?'), ('hl', 'online service me problem aa rahi hai kya kare')],
    'panchayat_01': [('en', 'which posts are directly elected in the panchayat election'), ('en', 'how is the pramukh elected, directly or indirectly'),
                     ('hi', 'पंचायत चुनाव में किन पदों पर सीधा चुनाव होता है?'), ('hl', 'mukhiya ka chunav seedha hota hai kya')],
    'panchayat_02': [('en', 'what is the reservation limit in panchayat elections'), ('en', 'rotation of reserved seats in panchayat'),
                     ('hi', 'पंचायत चुनाव में आरक्षण की सीमा कितनी है?'), ('hl', 'panchayat me aarakshan rotation kya hai')],
    'panchayat_03': [('en', 'how is the panchayat voter list prepared'), ('en', 'how to remove a name from the panchayat voter list'),
                     ('hi', 'पंचायत मतदाता सूची में नाम कैसे जोड़ें?'), ('hl', 'panchayat voter list me naam kaise jode')],
    'panchayat_04': [('en', 'minimum age to contest a panchayat election'), ('en', 'nomination fee for mukhiya'),
                     ('hi', 'पंचायत चुनाव लड़ने की न्यूनतम आयु क्या है?'), ('hi', 'मुखिया पद का नामांकन शुल्क कितना है?'),
                     ('hl', 'mukhiya chunav ladne ki umar kitni honi chahiye')],
    'panchayat_05': [('en', 'how is voting done in panchayat elections'), ('en', 'campaign rules for panchayat election'),
                     ('hi', 'पंचायत चुनाव में मतदान की प्रक्रिया क्या है?'), ('hl', 'panchayat chunav me prachar ke niyam')],
    'panchayat_06': [('en', 'key statistics of panchayat election 2021'), ('en', 'digital innovations in panchayat general election 2021'),
                     ('hi', 'पंचायत आम निर्वाचन 2021 के मुख्य आंकड़े क्या थे?'), ('hl', '2021 panchayat chunav me kitne voter the')],
    'panchayat_07': [('en', 'what is a tendered ballot'), ('en', 'what is a challenged vote'),
                     ('hi', 'निविदत्त मतपत्र क्या है?'), ('hl', 'challenged vote kya hota hai')],
    'evoting_01': [('en', 'what is the purpose of the evoting secbhr app'), ('en', 'why was the evoting app made'),
                   ('hi', 'eVoting SECBHR ऐप का उद्देश्य क्या है?'), ('hl', 'evoting app kis liye hai')],
    'evoting_02': [('en', 'is the evoting app safe'), ('en', 'do I have to give data consent in the app'),
                   ('hi', 'क्या ई-वोटिंग ऐप सुरक्षित है?'), ('hl', 'evoting app safe hai kya')],
    'evoting_03': [('en', 'what languages is the evoting app available in'), ('en', 'can I use the app in english'),
                   ('hi', 'ई-वोटिंग ऐप किन भाषाओं में है?'), ('hl', 'app hindi me hai kya')],
    'evoting_04': [('en', 'minimum phone requirements for the evoting app'), ('en', 'how much RAM is needed for the evoting app'),
                   ('hi', 'ई-वोटिंग ऐप के लिए फोन में क्या होना चाहिए?'), ('hl', 'kitna RAM chahiye evoting app ke liye')],
    'evoting_05': [('en', 'can my whole family vote from one phone'), ('en', 'how many voters per device'),
                   ('hi', 'क्या पूरा परिवार एक ही मोबाइल से वोट कर सकता है?'), ('hl', 'ek phone se kitne log vote kar sakte hai')],
    'evoting_06': [('en', 'I lost my registered phone, can I still vote'), ('en', 'phone damaged before election day'),
                   ('hi', 'पंजीकृत मोबाइल खो जाए तो क्या करें?'), ('hl', 'phone kho gaya to vote kaise karu')],
    'evoting_07': [('en', 'what do I need before registering on the evoting app'), ('en', 'what to keep ready for evoting registration'),
                   ('hi', 'ई-वोटिंग पंजीकरण से पहले क्या तैयार रखें?'), ('hl', 'registration se pehle kya chahiye')],
    'evoting_08': [('en', 'why does the app need camera permission'), ('en', 'why is a selfie needed in evoting registration'),
                   ('hi', 'पंजीकरण में सेल्फी क्यों जरूरी है?'), ('hl', 'selfie kyu lena padta hai app me')],
    'evoting_09': [('en', 'steps to register on the evoting app'), ('en', 'how to register for evoting'),
                   ('hi', 'ई-वोटिंग ऐप पर पंजीकरण कैसे करें?'), ('hl', 'evoting app par registration kaise kare')],
    'evoting_10': [('en', 'how to vote on election day using the app'), ('en', 'procedure to cast vote through evoting'),
                   ('hi', 'मतदान के दिन ऐप से वोट कैसे डालें?'), ('hl', 'voting day par app se vote kaise de')],
    'evoting_11': [('en', 'how do I select a candidate on the digital ballot'), ('en', 'how to mark my vote on the ballot sheet in the app'),
                   ('hi', 'डिजिटल बैलेट शीट पर वोट कैसे करें?'), ('hl', 'ballot sheet me candidate kaise select kare')],
    'evoting_12': [('en', 'is there a time limit to vote in the app'), ('en', 'how many minutes do I get to vote'),
                   ('hi', 'वोट डालने की समय सीमा कितनी है?'), ('hl', 'vote dalne ka time limit hai kya')],
    'evoting_13': [('en', 'can I skip voting for one post'), ('en', 'do I have to vote for all posts'),
                   ('hi', 'क्या किसी पद के लिए वोट छोड़ सकते हैं?'), ('hl', 'kisi post ko skip kar sakte hai kya')],
    'evoting_14': [('en', 'how do I know my vote was counted correctly'), ('en', 'vote verification in evoting'),
                   ('hi', 'कैसे पता करें कि मेरा वोट सही पड़ा?'), ('hl', 'mera vote sahi gaya kaise check kare')],
    'evoting_15': [('en', 'OTP not received in the evoting app'), ('en', 'not getting OTP what should I do'),
                   ('hi', 'ओटीपी नहीं आ रहा है क्या करें?'), ('hl', 'OTP nahi aa raha')],
    'evoting_16': [('en', 'where to get help if the evoting app has a problem'), ('en', 'evoting app support contact'),
                   ('hi', 'ऐप में तकनीकी दिक्कत हो तो मदद कहाँ मिलेगी?'), ('hl', 'app me problem ho to kisse contact kare')],
    'evoting_17': [('en', 'where to enter a panchayat merged into a nagar panchayat in the software'),
                   ('hi', 'नगर पंचायत में शामिल पंचायत की प्रविष्टि सॉफ्टवेयर में कहाँ करें?')],
    'evoting_18': [('en', 'entry rules for affected and unaffected parts of a panchayat shifted to nagar panchayat'),
                   ('hl', 'prabhavit aur aprabhavit bhag ki entry kaise kare')],
    'evoting_19': [('en', 'will the ward serial number change if a panchayat becomes an urban local body'),
                   ('hi', 'पंचायत के नगर निकाय में जाने पर क्या वार्ड का क्रमांक बदलेगा?')],
    'evoting_20': [('en', 'rule for correcting the boundary chauhaddi'), ('hi', 'चौहद्दी मिलान कर सुधार का नियम क्या है?')],
    'evoting_21': [('en', 'how to record chauhaddi for a panchayat moved into nagar panchayat')],
    'evoting_22': [('en', 'do I need to enter panchayat samiti population separately if ward population is entered')],
    'evoting_23': [('en', 'how to delete an abolished ward from the software'), ('hi', 'समाप्त वार्ड को सॉफ्टवेयर से कैसे हटाएं?')],
    'evoting_24': [('en', 'will the panchayat samiti continue if most wards move to the municipality')],
    'evoting_25': [('en', 'can one user log in on two computers at the same time'), ('hl', 'ek user do computer par login kar sakta hai kya')],
}

# ---- Act questions: gold = list of "family:section" ----
ACT = [
    ('en', 'how long is the term of a gram panchayat', ['panchayat_act:14']),
    ('hi', 'ग्राम पंचायत का कार्यकाल कितना होता है?', ['panchayat_act:14']),
    ('en', 'how is the mukhiya elected', ['panchayat_act:15']),
    ('en', 'how can a mukhiya be removed from office', ['panchayat_act:18']),
    ('hi', 'मुखिया को पद से कैसे हटाया जा सकता है?', ['panchayat_act:18']),
    ('en', 'what is the quorum for a gram sabha meeting', ['panchayat_act:5']),
    ('en', 'how often must the gram sabha meet', ['panchayat_act:3']),
    ('hi', 'ग्राम सभा की बैठक कितने समय में होनी चाहिए?', ['panchayat_act:3']),
    ('en', 'who conducts panchayat elections in bihar', ['panchayat_act:123']),
    ('en', 'who provides staff for conducting panchayat elections', ['panchayat_act:125']),
    ('en', 'can liquor be sold on polling day', ['panchayat_act:132', 'municipal_act:472']),
    ('hi', 'मतदान के दिन शराब की बिक्री पर क्या नियम है?', ['panchayat_act:132', 'municipal_act:472']),
    ('en', 'is there a paid holiday for employees on polling day', ['panchayat_act:131', 'municipal_act:471']),
    ('en', 'what is the maximum election expense a candidate can spend', ['panchayat_act:133', 'municipal_act:473']),
    ('en', 'who is disqualified from being a member of a panchayat', ['panchayat_act:136']),
    ('en', 'how to file an election petition', ['panchayat_act:137', 'municipal_act:476', 'municipal_act:477']),
    ('en', 'what are corrupt practices in elections', ['panchayat_act:141', 'municipal_act:481']),
    ('en', 'what is the duration of a zila parishad', ['panchayat_act:66']),
    ('en', 'how is the pramukh of panchayat samiti elected', ['panchayat_act:40']),
    ('en', 'reservation of seats in gram panchayat', ['panchayat_act:13']),
    ('hi', 'ग्राम पंचायत के कार्य क्या हैं?', ['panchayat_act:22']),
    ('en', 'who is a public servant under the panchayat act', ['panchayat_act:170']),
    ('en', 'what happens if the gram panchayat election cannot be held before its term ends', ['amend2021:2', 'panchayat_act:14']),
    ('hi', 'चुनाव न हो पाने पर ग्राम पंचायत का क्या होगा?', ['amend2021:2', 'panchayat_act:14']),
    ('en', 'criminal powers of the gram katchahry bench', ['panchayat_act:106', 'panchayat_act:107']),
    ('en', 'how many years is the term of a municipal councillor', ['municipal_act:16']),
    ('en', 'can voters recall a councillor', ['municipal_act:17']),
    ('hi', 'क्या पार्षद को वापस बुलाया जा सकता है?', ['municipal_act:17']),
    ('en', 'who is disqualified from being a councillor', ['municipal_act:18']),
    ('en', 'how is the chief councillor elected', ['municipal_act:23']),
    ('en', 'how can the chief councillor be removed', ['municipal_act:25']),
    ('en', 'penalty for a candidate filing a false affidavit', ['municipal_act:447']),
    ('en', 'what is the offence of booth capturing', ['municipal_act:469']),
    ('hi', 'मतदान केन्द्र पर कब्जा करने का अपराध क्या है?', ['municipal_act:469']),
    ('en', 'is canvassing allowed near a polling station', ['municipal_act:460']),
    ('en', 'can someone go armed to a polling station', ['municipal_act:467']),
    ('en', 'who is the district election officer for municipal elections', ['municipal_act:453']),
    ('en', 'who has the right to vote in municipal elections', ['municipal_act:449', 'municipal_act:451']),
    ('en', 'how are municipal areas classified', ['municipal_act:7']),
    ('hi', 'नगरपालिका क्षेत्रों का वर्गीकरण कैसे होता है?', ['municipal_act:7']),
    ('en', 'what population is needed to declare a nagar panchayat', ['municipal_act:3']),
    ('en', 'are public meetings allowed just before polling', ['municipal_act:455']),
]

# ---- Case-study questions: gold = case-study entry ids (suffix after "evoting_case_study_en:") ----
CASE = [
    ('en', 'how are votes protected with end to end encryption in evoting', ['addressing-data-security-privacy-aspects']),
    ('en', 'what challenges did bihar face in implementing evoting', ['challenges']),
    ('en', 'why did bihar introduce evoting in the 2025 urban local body elections', ['rationale-for-evoting-in-bihar-ulb-elections-2025', 'introduction', 'objectives']),
    ('en', 'who developed the evoting application', ['development-implementation', 'annexure-1-e-voting-application-developed-by-the-c-dac', 'annexure-2-e-voting-application-developed-by-the-in-house-te']),
    ('en', 'what was the impact of evoting in bihar', ['impact-created']),
    ('en', 'what are the benefits of evoting', ['benefits-of-evoting']),
    ('en', 'was blockchain used in the evoting system', ['foreword', 'development-implementation', 'addressing-data-security-privacy-aspects', 'introduction']),
    ('en', 'how does face recognition verify the voter in the evoting app', ['annexure-2-e-voting-application-developed-by-the-in-house-te', 'addressing-data-security-privacy-aspects', 'img-p30-1']),
    ('en', 'selfie guidelines for evoting registration', ['img-p36-4']),
    ('hi', 'सेल्फी लेते समय किन बातों का ध्यान रखें?', ['img-p36-4']),
    ('en', 'what is the future plan for evoting', ['future-vision-and-conclusion']),
    ('en', 'what were the objectives of the evoting initiative', ['objectives']),
    ('en', 'steps in the C-DAC evoting app', ['annexure-1-e-voting-application-developed-by-the-c-dac', 'img-p23-1', 'img-p23-2', 'img-p23-3', 'img-p24-1', 'img-p24-2']),
    ('en', 'poll day option in the in-house evoting app', ['annexure-2-e-voting-application-developed-by-the-in-house-te', 'img-p31-1']),
    ('en', 'how was evoting implemented step by step', ['structured-implementation-process', 'development-implementation']),
    ('en', 'what inspired bihar to start evoting', ['inspiration']),
    ('hi', 'ई-वोटिंग से क्या लाभ हुआ?', ['impact-created', 'benefits-of-evoting']),
    ('hl', 'evoting me data kaise surakshit rakha gaya', ['addressing-data-security-privacy-aspects']),
]

# ---- Out of scope: no FAQ should match ----
OOS = [
    ('en', 'who will win the bihar assembly election'), ('en', 'which party should I vote for'), ('en', 'what is the weather in patna today'),
    ('en', 'tell me a joke'), ('en', 'how do I apply for a passport'), ('en', 'what is the capital of france'),
    ('en', 'best biryani in patna'), ('en', 'my laptop is not starting'), ('en', 'price of petrol today'),
    ('en', 'who is the chief minister of bihar'), ('en', 'write python code to sort a list'), ('en', 'IPL score'),
    ('en', 'how to get a ration card'), ('en', 'how to apply for PM kisan'), ('en', 'book a train ticket'),
    ('en', 'bank loan interest rate'), ('en', 'how to lose weight'), ('en', 'date of the next lok sabha election'),
    ('hi', 'बिहार विधानसभा चुनाव कौन जीतेगा?'), ('hi', 'आज पटना का मौसम कैसा है?'), ('hi', 'राशन कार्ड कैसे बनवाएं?'),
    ('hi', 'मुझे एक चुटकुला सुनाओ'), ('hi', 'किस पार्टी को वोट दूं?'), ('hi', 'पासपोर्ट कैसे बनवाएं?'),
    ('hi', 'प्रधानमंत्री कौन है?'), ('hi', 'पेट्रोल का दाम क्या है?'),
    ('hl', 'kaun party jeetegi'), ('hl', 'aaj mausam kaisa hai'), ('hl', 'ration card kaise banaye'), ('hl', 'joke sunao'),
    ('hl', 'cricket score batao'), ('hl', 'mera phone hang ho raha hai'), ('hl', 'hello kaise ho'), ('en', 'hi, how are you?'),
]


def split_of(text):
    return 'test' if int(hashlib.md5(text.encode('utf-8')).hexdigest(), 16) % 10 < 3 else 'dev'


def main():
    faqs = json.loads((OUT / 'faqs.json').read_text(encoding='utf-8'))
    by_q = {}
    for f in faqs:  # identical questions in the municipal and panchayat sheets count as the same answer
        by_q.setdefault(f['q_en'].strip().lower(), []).append(f['id'])
    equiv = {fid: ids for ids in by_q.values() for fid in ids}

    rows = []
    for fid, items in FAQ.items():
        for lang, text in items:
            rows.append({'type': 'faq', 'lang': lang, 'text': text, 'gold_faq': equiv[fid]})
    for lang, text, gold in ACT:
        rows.append({'type': 'act', 'lang': lang, 'text': text, 'gold_sections': gold})
    for lang, text, gold in CASE:
        rows.append({'type': 'case', 'lang': lang, 'text': text, 'gold_sections': [f'case:{g}' for g in gold]})
    for lang, text in OOS:
        rows.append({'type': 'oos', 'lang': lang, 'text': text})
    for i, r in enumerate(rows):
        r['id'] = f'q{i + 1:03d}'
        r['split'] = split_of(r['text'])

    out = OUT / 'eval'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'questions.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')
    from collections import Counter
    print(f'{len(rows)} questions:', dict(Counter(r['type'] for r in rows)), '| langs', dict(Counter(r['lang'] for r in rows)),
          '| split', dict(Counter(r['split'] for r in rows)))
    missing = [fid for fid in equiv if not any(fid in r.get('gold_faq', []) for r in rows)]
    print('FAQs with no test question:', missing or 'none')


if __name__ == '__main__':
    main()
