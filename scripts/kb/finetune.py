"""Phase 2 - Fine-tune the embedding model on SEC Bihar data (contrastive learning).

Loss: MultipleNegativesRankingLoss (InfoNCE with in-batch negatives) on (anchor, positive, hard negative) triplets.
Training pairs (dev split only - test questions are never seen):
  - dev FAQ paraphrases           -> the FAQ question (EN and HI) and Q+A text
  - FAQ question EN <-> HI        -> aligns the two languages
  - FAQ keywords                  -> the FAQ question
  - dev Act / case-study questions-> the gold section's best chunk
Hard negatives: the highest-ranked wrong FAQ / section from BM25.

Usage: python finetune.py <base-model-key> [epochs]
Output: kb-work/models/<base>-secbihar  (then evaluate with: python eval_retrieval.py <base>-ft)
"""
import json
import random
import sys

import numpy as np
from common import OUT, WORK
from retrieval import MODELS, BM25, load_corpora


def main():
    from datasets import Dataset
    from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments
    from sentence_transformers.losses import MultipleNegativesRankingLoss

    base = sys.argv[1]
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    name, qp, pp = MODELS[base]
    random.seed(13)
    questions = json.loads((OUT / 'eval' / 'questions.json').read_text(encoding='utf-8'))
    sec_chunks, faq_units, faqs, _ = load_corpora()
    fby = {f['id']: f for f in faqs}
    faq_bm25 = BM25([f['q_en'] + ' ' + f['q_hi'] for f in faqs])
    sec_bm25 = BM25([c['text'] for c in sec_chunks])

    def hard_neg_faq(text, gold):
        order = np.argsort(-faq_bm25.scores(text))
        for i in order:
            if faqs[i]['id'] not in gold:
                return faqs[i]
        return faqs[0]

    rows = []
    for q in questions:
        if q['split'] != 'dev':
            continue
        if q['type'] == 'faq':
            pos = fby[q['gold_faq'][0]]
            neg = hard_neg_faq(q['text'], set(q['gold_faq']))
            for p_text, n_text in ((pos['q_en'], neg['q_en']), (pos['q_hi'], neg['q_hi']),
                                   (pos['q_en'] + '\n' + pos['a_en'], neg['q_en'] + '\n' + neg['a_en'])):
                rows.append((qp + q['text'], pp + p_text, pp + n_text))
        elif q['type'] in ('act', 'case'):
            gold = set(q['gold_sections'])
            scores = sec_bm25.scores(q['text'])
            cand = [i for i in np.argsort(-scores)[:50]]
            pos_i = next((i for i in cand if sec_chunks[i]['key'] in gold), None)
            if pos_i is None:
                pos_i = next(i for i, c in enumerate(sec_chunks) if c['key'] in gold)
            neg_i = next(i for i in cand if sec_chunks[i]['key'] not in gold)
            rows.append((qp + q['text'], pp + sec_chunks[pos_i]['text'], pp + sec_chunks[neg_i]['text']))
    for f in faqs:  # cross-lingual alignment + keywords (corpus-only data, no test leakage)
        neg = hard_neg_faq(f['q_en'], {f['id']})
        rows.append((qp + f['q_hi'], pp + f['q_en'], pp + neg['q_en']))
        rows.append((qp + f['q_en'], pp + f['q_hi'], pp + neg['q_hi']))
        if f['keywords_en']:
            rows.append((qp + ', '.join(f['keywords_en']), pp + f['q_en'], pp + neg['q_en']))
    random.shuffle(rows)
    print(f'{len(rows)} training triplets')

    model = SentenceTransformer(name, device='cpu')
    model.max_seq_length = 256
    ds = Dataset.from_dict({'anchor': [r[0] for r in rows], 'positive': [r[1] for r in rows],
                            'negative': [r[2] for r in rows]})
    out_dir = WORK / 'models' / f'{base}-secbihar'
    args = SentenceTransformerTrainingArguments(
        output_dir=str(WORK / 'models' / 'tmp'), num_train_epochs=epochs, per_device_train_batch_size=16,
        learning_rate=2e-5, warmup_ratio=0.1, logging_steps=20, save_strategy='no', report_to=[], seed=13,
        use_cpu=True)
    trainer = SentenceTransformerTrainer(model=model, args=args, train_dataset=ds,
                                         loss=MultipleNegativesRankingLoss(model))
    trainer.train()
    model.save(str(out_dir))
    print(f'saved fine-tuned model -> {out_dir}')


if __name__ == '__main__':
    main()
