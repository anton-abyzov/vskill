---
description: "LoRA/QLoRA hyperparameter configs, fine-tune vs RAG decision framework, quantization format comparison, and model-architecture-specific target modules."
model: opus
context: fork
---

# LLM Fine-Tuning

## Fine-Tune vs RAG Decision Framework

| Approach | Best When | Cost | Time | Maintenance |
|----------|-----------|------|------|-------------|
| Prompt Engineering | Behavior is achievable with instructions | Lowest | Minutes | Low |
| RAG | Model needs access to specific knowledge | Medium | Hours | Medium (index updates) |
| Fine-Tuning | Model needs new behavior/style/format | High | Hours-Days | High (retraining) |
| Fine-Tune + RAG | Need both new behavior AND specific knowledge | Highest | Days | Highest |

Choose fine-tuning when:
- Prompt engineering cannot achieve the desired output format or style
- You need consistent behavior that prompt instructions cannot guarantee
- You have 500+ high-quality training examples
- The task is repetitive and well-defined (classification, extraction, formatting)
- You need to reduce token usage (shorter prompts after fine-tuning)

Do NOT fine-tune when:
- Prompt engineering or few-shot examples work well enough
- Your data is small (< 100 examples) or low quality
- The knowledge changes frequently (use RAG instead)

## LoRA Hyperparameter Configs by Architecture

### Target Modules per Model Family

```python
# Llama/Mistral: q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
# GPT-NeoX:      query_key_value, dense, dense_h_to_4h, dense_4h_to_h
# Falcon:        query_key_value, dense, dense_h_to_4h, dense_4h_to_h
```

### Rank Selection Guide

| Rank (r) | Use Case |
|----------|----------|
| 4-8 | Simple style transfer, format adaptation |
| 16-32 | General fine-tuning, most tasks |
| 64-128 | Complex domain adaptation, multilingual |
| 256+ | Approaching full fine-tune quality |

### Recommended LoRA Config

```python
from peft import LoraConfig, get_peft_model, TaskType

lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,                          # Start here, increase if underfitting
    lora_alpha=32,                 # Usually 2x rank
    lora_dropout=0.05,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",  # Attention (always)
        "gate_proj", "up_proj", "down_proj",       # MLP (optional, more capacity)
    ],
    bias="none",
)

model = get_peft_model(base_model, lora_config)
model.print_trainable_parameters()
```

## QLoRA with bitsandbytes

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",           # NormalFloat4 (best for LLMs)
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,       # Nested quantization saves ~0.4 bits/param
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-3.1-8B",
    quantization_config=bnb_config,
    device_map="auto",
    torch_dtype=torch.bfloat16,
    attn_implementation="flash_attention_2",
)

tokenizer = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B")
tokenizer.pad_token = tokenizer.eos_token

model = prepare_model_for_kbit_training(model)

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules="all-linear",  # Shorthand: targets all linear layers
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(model, lora_config)
```

### QLoRA Hardware Requirements

| Model Size | VRAM (QLoRA) | VRAM (Full Fine-Tune) | GPU Example |
|-----------|-------------|----------------------|-------------|
| 7-8B | 6-10 GB | 60+ GB | RTX 3090/4090 |
| 13B | 10-16 GB | 100+ GB | RTX 4090/A6000 |
| 34B | 20-28 GB | 250+ GB | A100 40GB |
| 70B | 36-48 GB | 500+ GB | A100 80GB |

## SFTTrainer Config

```python
from trl import SFTTrainer, SFTConfig

training_args = SFTConfig(
    output_dir="./results",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,    # Effective batch size = 4 * 4 = 16
    gradient_checkpointing=True,       # Saves VRAM at cost of ~20% speed
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    weight_decay=0.01,
    max_seq_length=2048,
    packing=True,                      # Pack multiple short examples per sequence
    bf16=True,
    logging_steps=10,
    save_strategy="steps",
    save_steps=100,
    eval_strategy="steps",
    eval_steps=100,
    save_total_limit=3,
    load_best_model_at_end=True,
    report_to="wandb",
    dataset_text_field="text",
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    tokenizer=tokenizer,
    peft_config=lora_config,
)

trainer.train()
trainer.save_model("./final_adapter")
```

### Training Hyperparameter Ranges

| Parameter | Recommended | Notes |
|-----------|------------|-------|
| Learning rate | 1e-5 to 3e-4 | 2e-4 safe default for LoRA |
| Epochs | 1-5 | Monitor eval loss for overfitting |
| Batch size (effective) | 8-64 | Larger = more stable |
| Warmup ratio | 0.03-0.1 | Prevents early instability |
| Weight decay | 0.01-0.1 | 0.01 safe default |
| Max seq length | 512-4096 | Longer = more VRAM |

## Quantization Format Comparison

| Format | Bits | Speed | Quality | Use Case |
|--------|------|-------|---------|----------|
| BF16 | 16 | Baseline | Best | Training, high-end inference |
| GPTQ | 4/8 | Fast (GPU) | Very good | GPU deployment |
| AWQ | 4 | Fastest (GPU) | Very good | GPU deployment, best perf |
| GGUF | 2-8 | Good (CPU/GPU) | Varies | llama.cpp, local inference |
| bitsandbytes | 4/8 | Moderate | Good | Training (QLoRA), prototyping |

### GGUF Quantization Levels

```bash
# q2_k   - 2-bit (smallest, lowest quality)
# q4_0   - 4-bit (fast, decent quality)
# q4_k_m - 4-bit k-quant medium (best balance)
# q5_k_m - 5-bit k-quant medium (good quality)
# q6_k   - 6-bit (high quality)
# q8_0   - 8-bit (near lossless)

python llama.cpp/convert_hf_to_gguf.py \
    ./model-directory \
    --outfile model.gguf \
    --outtype q4_k_m
```

## Distributed Training: ZeRO Stage Selection

| Stage | Shards | VRAM Savings | Use When |
|-------|--------|-------------|----------|
| ZeRO-1 | Optimizer states | ~4x | 2-4 GPUs, large batch |
| ZeRO-2 | + Gradients | ~8x | 4-8 GPUs, standard |
| ZeRO-3 | + Parameters | ~Nx | Model too large for 1 GPU |
| ZeRO-3 + Offload | + CPU offload | Maximum | Maximum VRAM savings |
