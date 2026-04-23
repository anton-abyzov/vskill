# LLM Integration Report — vskill ↔ Local LLMs

**Date:** 2026-04-23
**Repo:** vskill @ 0.5.84
**Host:** macOS (darwin)
**Tested by:** delegated agent (live, non-simulated)

## Environment

| Runtime | Installed | Running | Endpoint | Version |
|---|---|---|---|---|
| Ollama | yes (`/usr/local/bin/ollama`) | yes | `http://localhost:11434` | 0.21.0 |
| LM Studio | yes (local server on) | yes | `http://localhost:1234` | OpenAI-compat API |

### Ollama models available
- `qwen3:8b` (5.2 GB, Q4_K_M) — used for the test (smallest available)
- `gemma4:e4b` (9.6 GB)
- `qwen3-coder:30b` (18.6 GB)
- `qwen3:32b` (20.2 GB)

No model smaller than 8B was already pulled. Per the brief, if no small model is present we should consider `ollama pull qwen2.5:0.5b`, but since `qwen3:8b` was already resident and the adapter is agnostic to model size, I tested with it to avoid an unnecessary multi-GB download. The behavioral test does not need a tiny model — it just needs a reachable one.

### LM Studio models available
- `llama-3.2-3b-instruct` (3B — smallest) — used for the test
- `gemma-4-e4b-it-ud-mlx`
- `mlx-community/gemma-4-26b-a4b-it`, `google/gemma-4-26b-a4b`, `google/gemma-4-31b`
- `qwen/qwen3-coder-next`, `qwen/qwen3-coder-30b`
- `text-embedding-nomic-embed-text-v1.5` (embeddings, not a chat model)

## Ollama test — `createLlmClient({ provider: "ollama" })`

**Status:** ✅ PASS — real end-to-end call through vskill's compiled adapter (`dist/eval/llm.js`).

**Harness:** `/tmp/vskill-llm-test-ollama.mjs` imports `createLlmClient` and invokes `client.generate(systemPrompt, userPrompt)`. No mocking.

**Prompt:**
- system: `"You are a terse assistant. Reply only with the direct answer, no preamble."`
- user: `"Say hello in exactly 5 words."`

**Response (from vskill adapter):**
```json
{
  "ok": true,
  "wallMs": 13589,
  "adapterDurationMs": 13589,
  "inputTokens": 34,
  "outputTokens": 782,
  "billingMode": "free",
  "cost": 0,
  "model": "qwen3:8b",
  "textSample": "Hello, how are you doing?"
}
```

**Observations:**
- The adapter correctly hit `http://localhost:11434/api/generate`, parsed `data.response`, and surfaced token counts from `prompt_eval_count` / `eval_count`.
- `billingMode: "free"` and `cost: 0` are correct for local models.
- `outputTokens: 782` is high relative to the 5-word visible answer. This is a qwen3 reasoning-model artifact (thinking tokens count against `eval_count` in Ollama) rather than a vskill bug. Switch to a non-reasoning model like `llama3.1:8b` if exact output-token accounting matters.
- Total round trip ~13.6s for an 8B model on CPU/Metal — within `estimateDurationSec`'s 5–30s/call Ollama band.

## LM Studio test — raw OpenAI-compatible API

**Status:** ⚠️ PASS at the HTTP layer; ❌ no vskill adapter exists yet.

**Rationale:** `src/eval/llm.ts` enumerates providers `"anthropic" | "claude-cli" | "codex-cli" | "gemini-cli" | "ollama" | "openrouter"`. `grep -rni "lmstudio\|lm-studio\|1234"` across `src/` returns no real matches (only fixture noise like `"sk-1234..."`). So `createLlmClient({ provider: "lmstudio" })` would throw `Unknown VSKILL_EVAL_PROVIDER`.

**Harness:** `/tmp/vskill-llm-test-lmstudio.mjs` — raw `fetch` to `POST /v1/chat/completions`.

**Prompt:** same system/user prompts as the Ollama test.

**Response:**
```json
{
  "ok": true,
  "wallMs": 4723,
  "model": "llama-3.2-3b-instruct",
  "usage": {
    "prompt_tokens": 60,
    "completion_tokens": 8,
    "total_tokens": 68,
    "completion_tokens_details": { "reasoning_tokens": 0 }
  },
  "choiceFinishReason": "stop",
  "textSample": "Hello, how are you today?"
}
```

**Observations:**
- LM Studio's local server is fully functional and returns a clean OpenAI-shaped body (`choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`, `finish_reason`).
- 4.7s round trip for a 3B MLX model — materially faster than the 8B Ollama model.
- Implementing a vskill LM Studio adapter is trivial — the schema is OpenAI-identical, so `createOpenRouterClient` is a near-copy: swap base URL to `http://localhost:1234/v1`, drop the auth header, keep `billingMode: "free"` and `cost: 0`.

## Recommendations

1. **Ollama adapter (production-ready).** The path through `createLlmClient({ provider: "ollama" })` works end-to-end against a real server. No code change needed. Consider adding a docs note that reasoning models (qwen3, deepseek-r1) inflate `outputTokens` via thinking tokens.

2. **LM Studio adapter (missing — implement).** Add a `createLmStudioClient(modelOverride?)` case to `src/eval/llm.ts`. Suggested shape:
   - Provider name: `"lmstudio"`
   - Base URL: `process.env.LMSTUDIO_BASE_URL || "http://localhost:1234"`
   - Endpoint: `POST /v1/chat/completions` (OpenAI schema)
   - No auth header required
   - Default model: detect via `GET /v1/models` or require `VSKILL_EVAL_MODEL`
   - `billingMode: "free"`, `cost: 0`
   - Estimated ~40 LOC, mirror `createOpenRouterClient`.

3. **Discovery UX.** `estimateDurationSec` should gain an `"lmstudio"` entry (`[3, 15]` per call seems right based on this test). `pricing.getBillingMode("lmstudio")` should return `"free"`.

4. **Test coverage.** Once the adapter lands, add an integration test gated on `curl http://localhost:1234/v1/models` returning 200 — parallel to whatever pattern gates the Ollama integration tests.

5. **Model-listing helper.** Both local providers expose model lists at well-known endpoints (`/api/tags` for Ollama, `/v1/models` for LM Studio). A shared `listLocalModels(provider)` util would remove the need for users to hand-set `VSKILL_EVAL_MODEL` when one model is obvious.

## Artifacts

- `/tmp/vskill-llm-test-ollama.mjs` — Ollama harness (imports `dist/eval/llm.js`)
- `/tmp/vskill-llm-test-lmstudio.mjs` — LM Studio raw-HTTP harness

No vskill source code was modified, no dependencies installed, nothing committed.
