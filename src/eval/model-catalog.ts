// Shared provider picker catalog. Explicit new IDs do not change saved/default choices.
import { ANTHROPIC_CATALOG_SNAPSHOT, findAnthropicModel } from "./anthropic-catalog.js";
import type { ProviderName } from "./llm.js";

// Verified 2026-10-09 against https://developers.openai.com/api/docs/models/
// gpt-6.1-sol, gpt-6-astra and gpt-6-luna. Standard short-context pricing;
// above 272K input tokens, the full request costs 2x input and 1.5x output.
export const CURRENT_OPENAI_MODELS = [
  { id: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", inputPerMillion: 2, outputPerMillion: 10 },
  { id: "gpt-6-astra", displayName: "GPT-6 Astra", inputPerMillion: 10, outputPerMillion: 50 },
  { id: "gpt-6-luna", displayName: "GPT-6 Luna", inputPerMillion: 0.1, outputPerMillion: 0.5 },
] as const;

export interface ModelOption {
  id: string;       // raw model id passed to the provider
  label: string;    // human-readable display name
  pricing?: { prompt: number; completion: number };  // USD per 1M tokens
  // Concrete dated/canonical Anthropic ID this alias resolves to via the
  // catalog snapshot. Populated only on claude-cli rows so the picker can
  // surface "routing to claude-sonnet-4-6" under each generic alias.
  resolvedId?: string;
}

// 0711 — Anthropic models + pricing now derive from the dated catalog
// snapshot at `src/eval/anthropic-catalog.ts`. Manual maintenance of this
// list led to stale prices (Opus 4.7 shown at $15/$75 instead of $5/$25)
// because three different files held copies of the same fact. The catalog
// file is the single source of truth; CI fails if its snapshotDate is
// older than 6 months.
function buildAnthropicProviderModels(): ModelOption[] {
  return ANTHROPIC_CATALOG_SNAPSHOT.models
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.id,
      label: `${m.displayName} (API)${m.pricing.longContext ? " · base rate ≤100K input" : ""}`,
      pricing: {
        prompt: m.pricing.promptUsdPer1M,
        completion: m.pricing.completionUsdPer1M,
      },
    }));
}

function aliasInfo(alias: string, fallbackLabel: string): { label: string; resolvedId?: string } {
  const entry = findAnthropicModel(alias);
  if (!entry) return { label: fallbackLabel };
  return { label: entry.displayName, resolvedId: entry.id };
}

export const PROVIDER_MODELS: Record<ProviderName, ModelOption[]> = {
  // Opus first so it is the default when no override is set
  // (getEffectiveRawModel returns models[0]). Labels come from the catalog so
  // the picker shows the exact dated version (e.g. "Claude Opus 4.7"), not the
  // bare family name — keeps the Studio truthful when a model is bumped.
  "claude-cli": [
    { id: "opus", ...aliasInfo("opus", "Claude Opus") },
    { id: "sonnet", ...aliasInfo("sonnet", "Claude Sonnet") },
    { id: "haiku", ...aliasInfo("haiku", "Claude Haiku") },
    ...ANTHROPIC_CATALOG_SNAPSHOT.models
      .filter((m) => m.capabilities.includes("modern_thinking_budget"))
      .map((m) => ({ id: m.id, label: m.displayName, resolvedId: m.id })),
  ],
  "anthropic": buildAnthropicProviderModels(),
  // Ollama's model list is dynamic — populated by probeOllama() from GET
  // /api/tags. Empty by default (parity with "lm-studio") so an unreachable
  // or timed-out probe surfaces zero models instead of leaking a hardcoded
  // fallback that isn't actually installed (0876 US-001).
  "ollama": [],
  "gemini-cli": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  "codex-cli": [
    { id: "o3", label: "OpenAI o3" },
    { id: "o4-mini", label: "OpenAI o4-mini" },
    ...CURRENT_OPENAI_MODELS.map((m) => ({ id: m.id, label: m.displayName })),
  ],
  "openai": [
    { id: "gpt-4o-mini", label: "GPT-4o mini (API)", pricing: { prompt: 0.15, completion: 0.60 } },
    { id: "gpt-4o", label: "GPT-4o (API)", pricing: { prompt: 2.50, completion: 10 } },
    { id: "gpt-4.1", label: "GPT-4.1 (API)", pricing: { prompt: 2, completion: 8 } },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini (API)", pricing: { prompt: 0.40, completion: 1.60 } },
    { id: "o4-mini", label: "o4-mini (API)", pricing: { prompt: 1.10, completion: 4.40 } },
    ...CURRENT_OPENAI_MODELS.map((m) => ({
      id: m.id, label: `${m.displayName} (API) · base rate ≤272K input`,
      pricing: { prompt: m.inputPerMillion, completion: m.outputPerMillion },
    })),
  ],
  "openrouter": [
    // Anthropic via OpenRouter
    { id: "anthropic/claude-opus-4", label: "Claude Opus 4 (via OpenRouter)" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4 (via OpenRouter)" },
    // OpenAI via OpenRouter (0698 polish — Anton wants OpenAI first-class)
    { id: "openai/gpt-5", label: "GPT-5 (via OpenRouter)" },
    { id: "openai/gpt-5-mini", label: "GPT-5 mini (via OpenRouter)" },
    { id: "openai/o4-mini", label: "o4-mini (via OpenRouter)" },
    { id: "openai/o3", label: "OpenAI o3 (via OpenRouter)" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 (via OpenRouter)" },
    // Google + Meta
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (via OpenRouter)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
  ],
  // LM Studio's default model list is empty because the actual list depends on
  // what models the user has loaded. The probe at probeLmStudio() populates
  // this dynamically from GET /v1/models.
  "lm-studio": [],
  // 0857: `stub` is a deterministic TEST SEAM (src/eval/llm.ts createStubClient),
  // NOT a user-facing provider. This empty list exists only to satisfy the
  // `Record<ProviderName, ModelOption[]>` exhaustiveness check — `stub` is
  // deliberately excluded from `detectAvailableProviders()` and
  // `KNOWN_PROVIDER_NAMES`, so it never reaches /api/config or the picker.
  "stub": [],
};
