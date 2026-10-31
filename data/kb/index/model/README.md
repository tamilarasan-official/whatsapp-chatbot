---
tags:
- sentence-transformers
- sentence-similarity
- feature-extraction
- dense
- generated_from_trainer
- dataset_size:3103
- loss:MultipleNegativesRankingLoss
widget:
- source_sentence: 'query: e voting kaun kar sakta hai'
  sentences:
  - 'passage: Who can use the e-Voting facility?'
  - 'passage: What is e-Voting?'
  - 'passage: Can a voter choose to skip voting for a particular post?'
- source_sentence: 'query: e voting kaun kaun kar sakta hai'
  sentences:
  - 'passage: What is e-Voting?'
  - 'passage: Is eVoting SECBHR a secure app, and is it mandatory to provide data
    consent?'
  - 'passage: Who can use the e-Voting facility?'
- source_sentence: 'query: ई-वोटिंग सुविधा का लाभ कौन ले सकता है?'
  sentences:
  - 'passage: What is e-Voting?'
  - 'passage: Who can use the e-Voting facility?'
  - 'passage: What is the role of an Election Observer?'
- source_sentence: 'query: e voting kaun kaun kar sakta hai'
  sentences:
  - 'passage: ई-वोटिंग क्या है?'
  - 'passage: ई-वोटिंग सुविधा का उपयोग कौन कर सकता है?'
  - 'passage: What is the role of an Election Observer?'
- source_sentence: 'query: ई-वोटिंग सुविधा का उपयोग कौन कर सकता है?'
  sentences:
  - 'passage: What is e-Voting?'
  - 'passage: What are counting, Tendered Ballot and Challenged Vote?'
  - 'passage: Who can use the e-Voting facility?'
pipeline_tag: sentence-similarity
library_name: sentence-transformers
---

# SentenceTransformer

This is a [sentence-transformers](https://www.SBERT.net) model trained. It maps inputs to a 384-dimensional dense vector space and can be used for semantic textual similarity, semantic search, paraphrase mining, classification, clustering, and more.

## Model Details

### Model Description
- **Model Type:** Sentence Transformer
<!-- - **Base model:** [Unknown](https://huggingface.co/unknown) -->
- **Maximum Sequence Length:** 256 tokens
- **Output Dimensionality:** 384 dimensions
- **Similarity Function:** Cosine Similarity
- **Supported Modality:** Text
<!-- - **Training Dataset:** Unknown -->
<!-- - **Language:** Unknown -->
<!-- - **License:** Unknown -->

### Model Sources

- **Documentation:** [Sentence Transformers Documentation](https://sbert.net)
- **Repository:** [Sentence Transformers on GitHub](https://github.com/huggingface/sentence-transformers)
- **Hugging Face:** [Sentence Transformers on Hugging Face](https://huggingface.co/models?library=sentence-transformers)

### Full Model Architecture

```
SentenceTransformer(
  (0): Transformer({'transformer_task': 'feature-extraction', 'modality_config': {'text': {'method': 'forward', 'method_output_name': 'last_hidden_state'}}, 'module_output_name': 'token_embeddings', 'architecture': 'BertModel'})
  (1): Pooling({'embedding_dimension': 384, 'pooling_mode': 'mean', 'include_prompt': True})
  (2): Normalize({'module_input_name': 'sentence_embedding', 'module_output_name': 'sentence_embedding'})
)
```

## Usage

### Direct Usage (Sentence Transformers)

First install the Sentence Transformers library:

```bash
pip install -U sentence-transformers
```
Then you can load this model and run inference.
```python
from sentence_transformers import SentenceTransformer

# Download from the 🤗 Hub
model = SentenceTransformer("sentence_transformers_model_id")
# Run inference
sentences = [
    'query: ई-वोटिंग सुविधा का उपयोग कौन कर सकता है?',
    'passage: Who can use the e-Voting facility?',
    'passage: What is e-Voting?',
]
embeddings = model.encode(sentences)
print(embeddings.shape)
# [3, 384]

# Get the similarity scores for the embeddings
similarities = model.similarity(embeddings, embeddings)
print(similarities)
# tensor([[1.0000, 0.8287, 0.4984],
#         [0.8287, 1.0000, 0.6639],
#         [0.4984, 0.6639, 1.0000]])
```
<!--
### Direct Usage (Transformers)

<details><summary>Click to see the direct usage in Transformers</summary>

</details>
-->

<!--
### Downstream Usage (Sentence Transformers)

You can finetune this model on your own dataset.

<details><summary>Click to expand</summary>

</details>
-->

<!--
### Out-of-Scope Use

*List how the model may foreseeably be misused and address what users ought not to do with the model.*
-->

<!--
## Bias, Risks and Limitations

*What are the known or foreseeable issues stemming from this model? You could also flag here known failure cases or weaknesses of the model.*
-->

<!--
### Recommendations

*What are recommendations with respect to the foreseeable issues? For example, filtering explicit content.*
-->

## Training Details

### Training Dataset

#### Unnamed Dataset

* Size: 3,103 training samples
* Columns: <code>anchor</code>, <code>positive</code>, and <code>negative</code>
* Approximate statistics based on the first 100 samples:
  |          | anchor                                                                            | positive                                                                            | negative                                                                             |
  |:---------|:----------------------------------------------------------------------------------|:------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------|
  | type     | string                                                                            | string                                                                              | string                                                                               |
  | modality | text                                                                              | text                                                                                | text                                                                                 |
  | details  | <ul><li>min: 8 tokens</li><li>mean: 17.41 tokens</li><li>max: 37 tokens</li></ul> | <ul><li>min: 15 tokens</li><li>mean: 135.6 tokens</li><li>max: 256 tokens</li></ul> | <ul><li>min: 11 tokens</li><li>mean: 146.59 tokens</li><li>max: 256 tokens</li></ul> |
* Samples:
  | anchor                                                                         | positive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | negative                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  |:-------------------------------------------------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | <code>query: prachar kab band hota hai panchayat election me</code>            | <code>passage: What are the rules regarding the voting process, EVMs and campaigning?<br>• M2 model EVMs are used for the election of Gram Panchayat Mukhiya, Members, Panchayat Samiti Members and Zila Parishad Members.<br>• Elections for Gram Kachahari Panch and Sarpanch posts are conducted using traditional ballot papers and ballot boxes.<br>• Loudspeakers may be used for election campaigning only from 6:00 AM to 10:00 PM and are completely prohibited during the 48 hours preceding the end of polling.<br>• If a voter does not have a Voter ID Card (EPIC), any one of 16 alternative documents, such as a driving licence or passport, may be presented.</code>                                                                                                          | <code>passage: What are the rules regarding the reservation limit and rotation in Panchayat elections?<br>• The total reservation for Scheduled Castes (SC), Scheduled Tribes (ST) and Backward Classes (BC) together can be up to a maximum of 50% of the total posts.<br>• After reservation for SC and ST, up to a maximum of 20% of the total posts may be reserved for Backward Classes from the remaining posts.<br>• In each category, as far as possible, 50% of the total seats, but not more than 50%, are reserved for women of the respective category.<br>• Population in descending order is used for allocating reservation among different categories.<br>• Under the 2009 amendment of the State Government, the principle of rotation in reservation is to be applied after two consecutive general elections.</code> |
  | <code>query: financial assistance from state government kya hota hai</code>    | <code>passage: Bihar Municipal Act, 2007 › Section 72 › Financial assistance from State Government<br>(1) The State Government, may, from time to time,<br>give grants or financial assistance to the Municipality with or without direction to the manner in which such<br>grants or financial assistance shall be applied.<br>(2) The State Government may, for giving such grants or assistance, lay down a scheme which may<br>include the conditions of release of such grants or assistance and may provide for the division of<br>Municipalities into different classes for that purpose.<br>(3) The State Government may give grants to the Municipality for implementation, in full or in part, of.<br>any scheme included in the annual development plan of the Municipality.</code> | <code>passage: Bihar Panchayat Raj Act, 2006 › Section 28 › Financial Assistance to Gram  Panchayats<br>Subject<br>to<br>the<br>provisions of this section, every Panchayat shall, after an appropriation<br>made by law in this behalf, be entitled to receive grants in aid from the<br>Consolidated Fund of the State as recommended by the State Finance<br>Commission, constituted under the provisions of this Act, and as approved<br>and notified by the State Government.</code>                                                                                                                                                                                                                                                                                                                                               |
  | <code>query: special provisions relating to trade effluent kya hota hai</code> | <code>passage: Bihar Municipal Act, 2007 › Section 202 › Special provisions relating to trade effluent<br>Subject to the provisions of this Act and the regulations<br>made thereunder and of any other law for the time being in force, the occupier of any trade premises may,<br>with the approval of the Municipality or, so far as may be permitted by this Act or the regulations made<br>thereunder or any other law for the time being in force, without such approval, discharge into the municipal<br>drain any trade effluent proceeding from such premises.</code>                                                                                                                                                                                                                 | <code>passage: Bihar Municipal Act, 2007 › Section 203 › Special provisions regarding drainage of trade effluent<br>(d) to alter, amend, repair or renovate any purification plant, existing drain, apparatus, plant-<br>fitting or article used in connection with any municipal or house-drain<br>Chapter XXIV<br>Other Provisions Relating to Water-supply, Drainage and Sewerage</code>                                                                                                                                                                                                                                                                                                                                                                                                                                             |
* Loss: [<code>MultipleNegativesRankingLoss</code>](https://sbert.net/docs/package_reference/sentence_transformer/losses.html#multiplenegativesrankingloss) with these parameters:
  ```json
  {
      "scale": 20.0,
      "similarity_fct": "cos_sim",
      "gather_across_devices": false,
      "directions": [
          "query_to_doc"
      ],
      "partition_mode": "joint",
      "hardness_mode": null,
      "hardness_strength": 0.0
  }
  ```

### Training Hyperparameters
#### Non-Default Hyperparameters

- `per_device_train_batch_size`: 16
- `learning_rate`: 2e-05
- `num_train_epochs`: 1
- `warmup_ratio`: 0.1
- `use_cpu`: True
- `seed`: 13
- `dataloader_pin_memory`: False

#### All Hyperparameters
<details><summary>Click to expand</summary>

- `overwrite_output_dir`: False
- `do_predict`: False
- `prediction_loss_only`: True
- `per_device_train_batch_size`: 16
- `per_device_eval_batch_size`: 8
- `per_gpu_train_batch_size`: None
- `per_gpu_eval_batch_size`: None
- `gradient_accumulation_steps`: 1
- `eval_accumulation_steps`: None
- `torch_empty_cache_steps`: None
- `learning_rate`: 2e-05
- `weight_decay`: 0.0
- `adam_beta1`: 0.9
- `adam_beta2`: 0.999
- `adam_epsilon`: 1e-08
- `max_grad_norm`: 1.0
- `num_train_epochs`: 1
- `max_steps`: -1
- `lr_scheduler_type`: linear
- `lr_scheduler_kwargs`: None
- `warmup_ratio`: 0.1
- `warmup_steps`: 0
- `log_level`: passive
- `log_level_replica`: warning
- `log_on_each_node`: True
- `logging_nan_inf_filter`: True
- `save_safetensors`: True
- `save_on_each_node`: False
- `save_only_model`: False
- `restore_callback_states_from_checkpoint`: False
- `no_cuda`: False
- `use_cpu`: True
- `use_mps_device`: False
- `seed`: 13
- `data_seed`: None
- `jit_mode_eval`: False
- `bf16`: False
- `fp16`: False
- `fp16_opt_level`: O1
- `half_precision_backend`: auto
- `bf16_full_eval`: False
- `fp16_full_eval`: False
- `tf32`: None
- `local_rank`: 0
- `ddp_backend`: None
- `tpu_num_cores`: None
- `tpu_metrics_debug`: False
- `debug`: []
- `dataloader_drop_last`: False
- `dataloader_num_workers`: 0
- `dataloader_prefetch_factor`: None
- `past_index`: -1
- `disable_tqdm`: False
- `remove_unused_columns`: True
- `label_names`: None
- `load_best_model_at_end`: False
- `ignore_data_skip`: False
- `fsdp`: []
- `fsdp_min_num_params`: 0
- `fsdp_config`: {'min_num_params': 0, 'xla': False, 'xla_fsdp_v2': False, 'xla_fsdp_grad_ckpt': False}
- `fsdp_transformer_layer_cls_to_wrap`: None
- `accelerator_config`: {'split_batches': False, 'dispatch_batches': None, 'even_batches': True, 'use_seedable_sampler': True, 'non_blocking': False, 'gradient_accumulation_kwargs': None}
- `parallelism_config`: None
- `deepspeed`: None
- `label_smoothing_factor`: 0.0
- `optim`: adamw_torch_fused
- `optim_args`: None
- `adafactor`: False
- `group_by_length`: False
- `length_column_name`: length
- `project`: huggingface
- `trackio_space_id`: trackio
- `ddp_find_unused_parameters`: None
- `ddp_bucket_cap_mb`: None
- `ddp_broadcast_buffers`: False
- `dataloader_pin_memory`: False
- `dataloader_persistent_workers`: False
- `skip_memory_metrics`: True
- `use_legacy_prediction_loop`: False
- `push_to_hub`: False
- `resume_from_checkpoint`: None
- `hub_model_id`: None
- `hub_strategy`: every_save
- `hub_private_repo`: None
- `hub_always_push`: False
- `hub_revision`: None
- `gradient_checkpointing`: False
- `gradient_checkpointing_kwargs`: None
- `include_inputs_for_metrics`: False
- `include_for_metrics`: []
- `eval_do_concat_batches`: True
- `fp16_backend`: auto
- `push_to_hub_model_id`: None
- `push_to_hub_organization`: None
- `mp_parameters`: 
- `auto_find_batch_size`: False
- `full_determinism`: False
- `torchdynamo`: None
- `ray_scope`: last
- `ddp_timeout`: 1800
- `torch_compile`: False
- `torch_compile_backend`: None
- `torch_compile_mode`: None
- `include_tokens_per_second`: False
- `include_num_input_tokens_seen`: no
- `neftune_noise_alpha`: None
- `optim_target_modules`: None
- `batch_eval_metrics`: False
- `eval_on_start`: False
- `use_liger_kernel`: False
- `liger_kernel_config`: None
- `eval_use_gather_object`: False
- `average_tokens_across_devices`: True
- `prompts`: None
- `batch_sampler`: batch_sampler
- `multi_dataset_batch_sampler`: proportional
- `router_mapping`: {}
- `learning_rate_mapping`: {}

</details>

### Training Logs
| Epoch  | Step | Training Loss |
|:------:|:----:|:-------------:|
| 0.1031 | 20   | 0.2567        |
| 0.2062 | 40   | 0.2361        |
| 0.3093 | 60   | 0.1918        |
| 0.4124 | 80   | 0.2117        |
| 0.5155 | 100  | 0.2133        |
| 0.6186 | 120  | 0.1767        |
| 0.7216 | 140  | 0.2175        |
| 0.8247 | 160  | 0.1603        |
| 0.9278 | 180  | 0.1794        |


### Training Time
- **Training**: 41.7 minutes

### Framework Versions
- Python: 3.13.1
- Sentence Transformers: 6.2.0
- Transformers: 4.57.6
- PyTorch: 2.15.0+cpu
- Accelerate: 1.15.0
- Datasets: 3.6.0
- Tokenizers: 0.22.2

## Additional Resources

- [Training and Finetuning Embedding Models with Sentence Transformers](https://huggingface.co/blog/train-sentence-transformers): the end-to-end guide for training or finetuning Sentence Transformer models.
- [Introduction to Matryoshka Embedding Models](https://huggingface.co/blog/matryoshka): variable-size embeddings that can be truncated with minimal quality loss.
- [Binary and Scalar Embedding Quantization for Significantly Faster & Cheaper Retrieval](https://huggingface.co/blog/embedding-quantization): post-training compression of embedding vectors.
- [Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/multimodal-sentence-transformers): use text, image, audio, and video models through the same API.
- [Training and Finetuning Multimodal Embedding & Reranker Models with Sentence Transformers](https://huggingface.co/blog/train-multimodal-sentence-transformers): train multimodal embedding models, with a Visual Document Retrieval walkthrough.

## Citation

### BibTeX

#### Sentence Transformers
```bibtex
@inproceedings{reimers-2019-sentence-bert,
    title = "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
    author = "Reimers, Nils and Gurevych, Iryna",
    booktitle = "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing",
    month = "11",
    year = "2019",
    publisher = "Association for Computational Linguistics",
    url = "https://arxiv.org/abs/1908.10084",
}
```

#### MultipleNegativesRankingLoss
```bibtex
@misc{oord2019representationlearningcontrastivepredictive,
      title={Representation Learning with Contrastive Predictive Coding},
      author={Aaron van den Oord and Yazhe Li and Oriol Vinyals},
      year={2019},
      eprint={1807.03748},
      archivePrefix={arXiv},
      primaryClass={cs.LG},
      url={https://arxiv.org/abs/1807.03748},
}
```

<!--
## Glossary

*Clearly define terms in order to be accessible across audiences.*
-->

<!--
## Model Card Authors

*Lists the people who create the model card, providing recognition and accountability for the detailed work that goes into its construction.*
-->

<!--
## Model Card Contact

*Provides a way for people who have updates to the Model Card, suggestions, or questions, to contact the Model Card authors.*
-->