---
description: "TGI deployment configuration, Accelerate multi-GPU training patterns, Safetensors usage, and big model inference across devices."
model: opus
context: fork
---

# Hugging Face Ecosystem

## Text Generation Inference (TGI) Deployment

```bash
docker run --gpus all --shm-size 1g \
    -p 8080:80 \
    -v /path/to/model:/model \
    ghcr.io/huggingface/text-generation-inference:latest \
    --model-id /model \
    --dtype bfloat16 \
    --max-input-length 4096 \
    --max-total-tokens 8192 \
    --max-batch-prefill-tokens 4096 \
    --max-concurrent-requests 128
```

### TGI Client Usage

```python
from huggingface_hub import InferenceClient

client = InferenceClient("http://localhost:8080")

# Chat completions (OpenAI-compatible)
response = client.chat_completion(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is machine learning?"},
    ],
    max_tokens=512,
    temperature=0.7,
)
print(response.choices[0].message.content)

# Streaming
for token in client.text_generation(
    "Once upon a time",
    max_new_tokens=100,
    stream=True,
):
    print(token, end="")
```

## Accelerate Multi-GPU Training

### Custom Training Loop

```python
from accelerate import Accelerator

accelerator = Accelerator(
    mixed_precision="bf16",
    gradient_accumulation_steps=4,
    log_with="wandb",
)

model, optimizer, train_dataloader = accelerator.prepare(
    model, optimizer, train_dataloader
)

for epoch in range(num_epochs):
    model.train()
    for batch in train_dataloader:
        with accelerator.accumulate(model):
            outputs = model(**batch)
            loss = outputs.loss
            accelerator.backward(loss)
            optimizer.step()
            optimizer.zero_grad()

        accelerator.log({"train_loss": loss.item()})

# Save model (handles distributed state)
accelerator.wait_for_everyone()
unwrapped_model = accelerator.unwrap_model(model)
unwrapped_model.save_pretrained(
    "output",
    save_function=accelerator.save,
    state_dict=accelerator.get_state_dict(model),
)
```

### Accelerate Config and Launch

```yaml
# accelerate_config.yaml
compute_environment: LOCAL_MACHINE
distributed_type: MULTI_GPU
num_processes: 4
mixed_precision: bf16
use_cpu: false
gpu_ids: 0,1,2,3
```

```bash
accelerate launch --config_file accelerate_config.yaml train.py
```

### Big Model Inference (Model Parallelism)

```python
from accelerate import init_empty_weights, load_checkpoint_and_dispatch

with init_empty_weights():
    model = AutoModelForCausalLM.from_config(config)

model = load_checkpoint_and_dispatch(
    model,
    checkpoint="./model-weights",
    device_map="auto",
    no_split_module_classes=["LlamaDecoderLayer"],
    max_memory={0: "20GiB", 1: "20GiB", "cpu": "30GiB"},
)
```

## Safetensors

```python
from safetensors.torch import save_file, load_file

tensors = {"weight": torch.randn(10, 10), "bias": torch.randn(10)}
save_file(tensors, "model.safetensors")
loaded = load_file("model.safetensors")

# Benefits over pickle-based formats:
# - No arbitrary code execution risk
# - Memory-mapped loading (fast, low memory)
# - Zero-copy loading on GPU
# - Format validation before loading
```

### Snapshot Download (skip .bin when safetensors available)

```python
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="meta-llama/Llama-3.1-8B",
    local_dir="./llama-3.1-8b",
    ignore_patterns=["*.bin"],  # Skip pytorch_model.bin if using safetensors
)
```

## PEFT Adapter Switching (Multiple Adapters)

```python
from peft import PeftModel

model = PeftModel.from_pretrained(base_model, "path/to/adapter")

# Multiple adapters
model.load_adapter("path/to/code-adapter", adapter_name="code")
model.load_adapter("path/to/chat-adapter", adapter_name="chat")

# Switch between adapters at runtime
model.set_adapter("code")
code_output = model.generate(**inputs)

model.set_adapter("chat")
chat_output = model.generate(**inputs)

# Merge adapter into base model (for deployment)
merged = model.merge_and_unload()
```
