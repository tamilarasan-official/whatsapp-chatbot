"""Phase 5 - Extra training data for the second fine-tune (training only, never scored).

1. Section-title queries, derived from the Acts themselves (no test leakage): for every Act section,
   its English title, its Hindi title and a Hinglish template ("<title> ke baare me kya niyam hai")
   -> that section. Teaches the model e.g. that "who cannot become a councillor" is "Disqualifications".
2. Hand-written Hinglish / casual paraphrases of the official FAQs (the weakest area in Phase 2).

Rows that are near-duplicates (word Jaccard >= 0.7) of any Phase 2 test question or Phase 5 accuracy test
are dropped, so both test sets stay unseen.
Output: data/kb/eval/train_extra.json  [{text, kind: 'section'|'faq', gold}]
"""
import json
import re
from common import OUT
from retrieval import FAMILY

HINGLISH_TEMPLATES = ['{t} ke baare me kya niyam hai', '{t} kya hota hai']

FAQ_HL = [
    ('panchayat_01', 'panchayat me direct aur indirect chunav wale pad kaun se hain'),
    ('panchayat_01', 'pramukh ka chunav janta karti hai ya sadasya'),
    ('panchayat_02', 'panchayat me SC ST aur pichhda varg ka aarakshan kitna hai'),
    ('panchayat_02', 'mahilaon ke liye kitni seat reserve hoti hai panchayat me'),
    ('panchayat_03', 'panchayat voter list kaise banti hai'),
    ('panchayat_03', 'form gha kis kaam aata hai'),
    ('panchayat_04', 'mukhiya ka parcha bharne ki fees kya hai'),
    ('panchayat_04', 'prastavak banne ke liye kya umar chahiye'),
    ('panchayat_04', 'anganwadi sevika chunav lad sakti hai kya'),
    ('panchayat_05', 'panchayat chunav me ballot paper hota hai ya evm'),
    ('panchayat_05', 'prachar kab band hota hai panchayat election me'),
    ('panchayat_06', '2021 panchayat election me kitne pad the aur kya naya hua'),
    ('panchayat_07', 'challenged vote ka matlab kya hai'),
    ('panchayat_07', 'panchayat ki ginti kaise hoti hai'),
    ('panchayat_08', 'returning officer aur assistant returning officer me kya fark hai'),
    ('panchayat_09', 'observer kaun niyukt karta hai chunav me'),
    ('panchayat_10', 'chunav ki adhisuchna kahan padh sakte hain'),
    ('panchayat_11', 'e roll me naam search karna hai'),
    ('panchayat_11', 'mera matdan kendra kaunsa hai kaise pata kare'),
    ('panchayat_12', 'matdata suvidha app kaise use kare'),
    ('panchayat_13', 'helpline number kya hai chunav aayog ka'),
    ('panchayat_14', 'dawa aapatti kahan jama kare'),
    ('panchayat_15', 'ward ka parisiman kaun karta hai'),
    ('panchayat_16', 'chunav lad rahe pratyashiyon ki jankari kahan milegi'),
    ('panchayat_17', 'chunav se judi shikayat online kaise kare'),
    ('panchayat_18', 'led prachar vahan ke liye anumati'),
    ('municipal_01', 'nagar nigam me mayor ka chunav evm se hota hai kya'),
    ('municipal_01', 'ek se zyada pad par nomination kar sakte hai kya'),
    ('municipal_02', 'matganana kaksh me kise jaane ki ijazat hai'),
    ('municipal_03', 'evm ka result button kab dabaya jata hai'),
    ('municipal_04', 'divyang matdata ki madad kaun kar sakta hai booth par'),
    ('municipal_04', 'naye parshad ko shapath kaun dilata hai'),
    ('municipal_05', 'nagar parishad ka chunav ladne ke liye kya karna hoga'),
    ('municipal_06', 'nomination me affidavit kyun dena padta hai'),
    ('municipal_07', 'parcha wapas lene ki aakhri tareekh ke baad kya hota hai'),
    ('municipal_08', 'free symbol list kahan milegi'),
    ('municipal_09', 'candidate suvidha portal pe permission kaise le'),
    ('municipal_10', 'deewar pe chunav prachar likhna mana hai kya'),
    ('municipal_11', 'model code of conduct me kya mana hota hai'),
    ('municipal_23', 'e voting matlab kya'),
    ('municipal_23', 'mobile se vote dena kya hota hai'),
    ('municipal_24', 'e voting kaun kaun kar sakta hai'),
    ('municipal_25', 'online seva kaam nahi kar rahi to kisse sampark kare'),
    ('evoting_01', 'secbhr app kis liye banaya gaya'),
    ('evoting_01', 'ghar baithe vote kaise de sakte hain'),
    ('evoting_02', 'app mera data surakshit rakhta hai kya'),
    ('evoting_03', 'app hindi me chalta hai kya'),
    ('evoting_04', 'kaunsa android version chahiye evoting ke liye'),
    ('evoting_05', 'ek phone pe kitne voter register ho sakte hain'),
    ('evoting_06', 'phone kho gaya to evoting kaise kare'),
    ('evoting_07', 'evoting registration ke liye epic number chahiye kya'),
    ('evoting_08', 'selfie kyun leni padti hai app me'),
    ('evoting_09', 'evoting me register kaise kare step by step'),
    ('evoting_10', 'chunav ke din app se vote kaise dale'),
    ('evoting_10', 'how do i cast my vote using the evoting app'),
    ('evoting_10', 'how can i vote through the mobile app on poll day'),
    ('evoting_11', 'ballot screen pe ummeedwar kaise chune'),
    ('evoting_12', 'vote dalne ke liye kitne minute milte hain'),
    ('evoting_13', 'kisi ek pad ke liye vote na de to chalega'),
    ('evoting_14', 'vote safal hua ya nahi kaise confirm kare'),
    ('evoting_15', 'otp nahi mil raha registration me'),
    ('evoting_16', 'app me dikkat ho to madad kahan se mile'),
    ('evoting_16', 'who can help me with problems in the voting app'),
    ('evoting_17', 'nagar panchayat me mili panchayat ki entry software me kahan kare'),
    ('evoting_19', 'ward ka kram sankhya badlega kya'),
    ('evoting_21', 'chauhaddi kaise darj kare jab panchayat nagar panchayat me chali jaye'),
    ('evoting_22', 'panchayat samiti ki aabadi alag se bharni hogi kya'),
    ('evoting_23', 'khatam hue ward ko software se kaise hataye'),
    ('evoting_25', 'ek user do system pe login kar sakta hai'),
]


def words(t):
    return set(re.findall(r'\w+', t.lower()))


def main():
    sections = json.loads((OUT / 'sections.json').read_text(encoding='utf-8'))
    rows = []
    seen = set()
    for s in sections:
        if s['doc'] not in FAMILY or not s.get('title'):
            continue
        key = f"{FAMILY[s['doc']]}:{s['section']}"
        title = re.sub(r'\s+', ' ', s['title']).strip(' .:-')
        if len(title) < 6 or (key, title) in seen:
            continue
        seen.add((key, title))
        rows.append({'text': title, 'kind': 'section', 'gold': key})
        if s['lang'] == 'en' and not s['doc'].endswith('_mt'):
            for tpl in HINGLISH_TEMPLATES:
                rows.append({'text': tpl.format(t=title.lower()), 'kind': 'section', 'gold': key})
    for fid, text in FAQ_HL:
        rows.append({'text': text, 'kind': 'faq', 'gold': fid})

    protected = [q['text'] for q in json.loads((OUT / 'eval' / 'questions.json').read_text(encoding='utf-8')) if q['split'] == 'test']
    tests = OUT / 'eval' / 'answer_tests.json'
    if tests.exists():
        protected += [t['text'] for t in json.loads(tests.read_text(encoding='utf-8'))]
    pw = [words(p) for p in protected]
    kept, dropped = [], []
    for r in rows:
        a = words(r['text'])
        if any(a and b and len(a & b) / len(a | b) >= 0.7 for b in pw):
            dropped.append(r['text'])
        else:
            kept.append(r)
    (OUT / 'eval' / 'train_extra.json').write_text(json.dumps(kept, ensure_ascii=False, indent=0), encoding='utf-8')
    print(f"{len(kept)} rows kept ({sum(r['kind'] == 'section' for r in kept)} section, {sum(r['kind'] == 'faq' for r in kept)} faq), "
          f"{len(dropped)} dropped as too close to a test question: {dropped}")


if __name__ == '__main__':
    main()
