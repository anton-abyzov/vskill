// ---------------------------------------------------------------------------
// pricing.ts -- centralized pricing table + cost calculator for all providers
//
// 0711: Anthropic pricing now derives from the dated catalog snapshot in
// `anthropic-catalog.ts` so we maintain rates in exactly one place. Other
// providers still use the inline table below until each gets its own
// catalog (tracked in 0711 follow-ups).
// ---------------------------------------------------------------------------

import { ANTHROPIC_CATALOG_SNAPSHOT } from "./anthropic-catalog.js";

export type BillingMode = "per-token" | "subscription" | "free";

export interface ModelPricing {
  inputPerMillion: number;   // $ per 1M input tokens
  outputPerMillion: number;  // $ per 1M output tokens
  updatedAt: string;         // ISO date for staleness detection
}

// ---------------------------------------------------------------------------
// Pricing table — update rates here when providers change pricing
// ---------------------------------------------------------------------------

function buildAnthropicPricing(): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {};
  for (const m of ANTHROPIC_CATALOG_SNAPSHOT.models) {
    out[m.id] = {
      inputPerMillion: m.pricing.promptUsdPer1M,
      outputPerMillion: m.pricing.completionUsdPer1M,
      updatedAt: ANTHROPIC_CATALOG_SNAPSHOT.snapshotDate,
    };
  }
  return out;
}

const PRICING: Record<string, Record<string, ModelPricing>> = {
  anthropic: buildAnthropicPricing(),
  openai: {
    "o4-mini": { inputPerMillion: 1.10, outputPerMillion: 4.40, updatedAt: "2025-05-01" },
    "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8, updatedAt: "2025-05-01" },
    "gpt-4.1-mini": { inputPerMillion: 0.40, outputPerMillion: 1.60, updatedAt: "2025-05-01" },
    "gpt-4o": { inputPerMillion: 2.50, outputPerMillion: 10, updatedAt: "2026-04-24" },
    "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60, updatedAt: "2026-04-24" },
  },
  google: {
    "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10, updatedAt: "2025-05-01" },
    "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.60, updatedAt: "2025-05-01" },
  },
};

// ---------------------------------------------------------------------------
// Model alias maps — resolve shorthand names to pricing table keys
// ---------------------------------------------------------------------------

// 0711: Anthropic alias resolution lives in `model-resolver.ts` (catalog +
// env override). Inline this map ONLY for the well-known short aliases that
// the resolver also accepts — keeps `getPricing()` synchronous and pure for
// existing callers. Full-ID lookups bypass this map entirely.
function buildAnthropicAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of ANTHROPIC_CATALOG_SNAPSHOT.models) {
    for (const a of m.aliases) {
      // Skip variants with [1m] suffix etc — getPricing keys are bare IDs.
      if (!out[a]) out[a] = m.id;
    }
  }
  // Legacy compat: vskill historically accepted these display-style strings.
  out["claude-sonnet"] ??= "claude-sonnet-4-6";
  out["claude-opus"] ??= "claude-opus-4-7";
  out["claude-haiku"] ??= "claude-haiku-4-5-20251001";
  return out;
}

const MODEL_ALIASES: Record<string, Record<string, string>> = {
  anthropic: buildAnthropicAliases(),
  openai: {},
  google: {},
};

// claude-cli and codex-cli use the same models as their API counterparts
const PROVIDER_PRICING_MAP: Record<string, string> = {
  "claude-cli": "anthropic",
  "codex-cli": "openai",
  "gemini-cli": "google",
};

// ---------------------------------------------------------------------------
// Billing mode per provider
// ---------------------------------------------------------------------------

const BILLING_MODES: Record<string, BillingMode> = {
  "anthropic": "per-token",
  "openai": "per-token",
  "openrouter": "per-token",
  "ollama": "free",
  "lm-studio": "free",
  "claude-cli": "subscription",
  "codex-cli": "subscription",
  "gemini-cli": "free",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the billing mode for a provider.
 */
export function getBillingMode(provider: string): BillingMode {
  return BILLING_MODES[provider] ?? "per-token";
}

/**
 * Look up pricing for a provider + model, resolving aliases.
 */
export function getProviderPricing(provider: string, model: string): ModelPricing | null {
  // Map CLI providers to their API pricing counterparts
  const pricingProvider = PROVIDER_PRICING_MAP[provider] ?? provider;
  const providerTable = PRICING[pricingProvider];
  if (!providerTable) return null;

  // Direct match
  if (providerTable[model]) return providerTable[model];

  // Alias resolution
  const aliases = MODEL_ALIASES[pricingProvider];
  if (aliases && aliases[model]) {
    const resolved = aliases[model];
    if (providerTable[resolved]) return providerTable[resolved];
  }

  return null;
}

/**
 * Calculate actual cost from token counts.
 * Returns null when tokens are unavailable, 0 for free providers.
 */
export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  // Free providers always cost $0
  if (getBillingMode(provider) === "free") return 0;

  // Cannot calculate without token data
  if (inputTokens == null || outputTokens == null) return null;

  const pricing = getProviderPricing(provider, model);
  if (!pricing) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Estimate cost for a planned run (before execution).
 * Uses the same calculation as calculateCost but clearly named for pre-run usage.
 */
export function estimateCost(
  provider: string,
  model: string,
  estInputTokens: number,
  estOutputTokens: number,
): number | null {
  return calculateCost(provider, model, estInputTokens, estOutputTokens);
}
