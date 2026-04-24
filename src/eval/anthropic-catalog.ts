// ---------------------------------------------------------------------------
// 0711: Anthropic model catalog — dated snapshot fixture
//
// Source-of-truth replacement for the scattered hardcoded model IDs that
// `ANTHROPIC_NORMALIZE` (llm.ts), `pricing.ts`, and `PROVIDER_MODELS`
// (api-routes.ts) used to maintain independently. Each release of this file
// MUST bump `snapshotDate`; CI fails if the date is older than 6 months
// (see `pricing-staleness.test.ts`). The picker UI surfaces a soft warning
// once the snapshot is older than 90 days.
//
// At runtime, `model-resolver.ts` prefers (in order):
//   1. ENV override — VSKILL_DEFAULT_MODEL_ANTHROPIC
//   2. Live `/v1/models` fetch (cached 24h) — only on the server, only if an
//      ANTHROPIC_API_KEY is present
//   3. This dated snapshot
//
// Source URLs (verified 2026-04-24):
// - https://platform.claude.com/docs/en/about-claude/models/overview
// - https://platform.claude.com/docs/en/about-claude/model-deprecations
// - https://claude.com/pricing
// - https://platform.claude.com/docs/en/api/models-list
// - https://code.claude.com/docs/en/model-config (CLI alias rules)
// ---------------------------------------------------------------------------

export type AnthropicModelStatus = "active" | "deprecated" | "retired";

export interface AnthropicPricing {
  /** USD per 1M input tokens. */
  promptUsdPer1M: number;
  /** USD per 1M output tokens. */
  completionUsdPer1M: number;
  /** USD per 1M cache-read tokens (5-minute TTL). */
  cacheReadUsdPer1M: number;
  /** USD per 1M cache-write tokens (5-minute TTL). 1hr-TTL writes are 2x input — not surfaced numerically by Anthropic, omitted here. */
  cacheWriteUsdPer1M: number;
}

export interface AnthropicModelEntry {
  /** Canonical Anthropic API ID (e.g. `claude-opus-4-7`, `claude-haiku-4-5-20251001`). */
  id: string;
  /** Aliased forms accepted by Anthropic API + Claude Code. */
  aliases: ReadonlyArray<string>;
  /** Marketing display name. */
  displayName: string;
  /** Maximum input tokens (full context window). */
  contextWindow: number;
  /** Maximum output tokens per request. */
  maxOutputTokens: number;
  pricing: AnthropicPricing;
  status: AnthropicModelStatus;
  /** Release date (ISO date) — null when not surfaced by docs. */
  releaseDate: string | null;
  /** Sunset / retirement date (ISO date) — null when no sunset announced. */
  sunsetDate: string | null;
  /** Capability tags surfaced by `/v1/models` (subset of relevant flags). */
  capabilities: ReadonlyArray<string>;
}

export interface AnthropicCatalog {
  /** ISO date when this snapshot was taken. */
  snapshotDate: string;
  /** Source page references for traceability. */
  sources: ReadonlyArray<string>;
  models: ReadonlyArray<AnthropicModelEntry>;
}

// 0711 — Anthropic catalog snapshot
// Last refreshed: 2026-04-24
// Cadence: refresh every <=6 months. CI fails if snapshotDate is older.
export const ANTHROPIC_CATALOG_SNAPSHOT: AnthropicCatalog = {
  snapshotDate: "2026-04-24",
  sources: [
    "https://platform.claude.com/docs/en/about-claude/models/overview",
    "https://platform.claude.com/docs/en/about-claude/model-deprecations",
    "https://claude.com/pricing",
    "https://platform.claude.com/docs/en/api/models-list",
    "https://code.claude.com/docs/en/model-config",
  ],
  models: [
    {
      id: "claude-opus-4-7",
      aliases: ["opus", "opus[1m]", "best", "claude-opus-4-7[1m]"],
      displayName: "Claude Opus 4.7",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: {
        promptUsdPer1M: 5.0,
        completionUsdPer1M: 25.0,
        cacheReadUsdPer1M: 0.5,
        cacheWriteUsdPer1M: 6.25,
      },
      status: "active",
      releaseDate: "2026-04-16",
      sunsetDate: null,
      capabilities: [
        "adaptive_thinking",
        "vision_highres",
        "pdf",
        "code_execution",
        "batch",
        "citations",
        "structured_outputs",
        "1m_context",
        "effort_xhigh",
        "task_budgets_beta",
      ],
    },
    {
      id: "claude-opus-4-6",
      aliases: [],
      displayName: "Claude Opus 4.6",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: {
        promptUsdPer1M: 5.0,
        completionUsdPer1M: 25.0,
        cacheReadUsdPer1M: 0.5,
        cacheWriteUsdPer1M: 6.25,
      },
      status: "active",
      releaseDate: "2026-02-05",
      sunsetDate: null,
      capabilities: [
        "extended_thinking",
        "adaptive_thinking",
        "vision",
        "1m_context",
        "effort_max",
      ],
    },
    {
      id: "claude-opus-4-5-20251101",
      aliases: ["claude-opus-4-5"],
      displayName: "Claude Opus 4.5",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      pricing: {
        promptUsdPer1M: 5.0,
        completionUsdPer1M: 25.0,
        cacheReadUsdPer1M: 0.5,
        cacheWriteUsdPer1M: 6.25,
      },
      status: "active",
      releaseDate: "2025-11-01",
      sunsetDate: "2026-11-24",
      capabilities: ["extended_thinking", "vision"],
    },
    {
      id: "claude-opus-4-1-20250805",
      aliases: ["claude-opus-4-1"],
      displayName: "Claude Opus 4.1",
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      pricing: {
        promptUsdPer1M: 15.0,
        completionUsdPer1M: 75.0,
        cacheReadUsdPer1M: 1.5,
        cacheWriteUsdPer1M: 18.75,
      },
      status: "active",
      releaseDate: "2025-08-05",
      sunsetDate: "2026-08-05",
      capabilities: ["extended_thinking", "vision"],
    },
    {
      id: "claude-opus-4-20250514",
      aliases: ["claude-opus-4-0"],
      displayName: "Claude Opus 4",
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      pricing: {
        promptUsdPer1M: 15.0,
        completionUsdPer1M: 75.0,
        cacheReadUsdPer1M: 1.5,
        cacheWriteUsdPer1M: 18.75,
      },
      status: "deprecated",
      releaseDate: "2025-05-14",
      sunsetDate: "2026-06-15",
      capabilities: ["extended_thinking", "vision"],
    },
    {
      id: "claude-sonnet-4-6",
      aliases: ["sonnet", "sonnet[1m]", "claude-sonnet-4-6[1m]"],
      displayName: "Claude Sonnet 4.6",
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      pricing: {
        promptUsdPer1M: 3.0,
        completionUsdPer1M: 15.0,
        cacheReadUsdPer1M: 0.3,
        cacheWriteUsdPer1M: 3.75,
      },
      status: "active",
      releaseDate: "2026-02-17",
      sunsetDate: null,
      capabilities: [
        "extended_thinking",
        "adaptive_thinking",
        "vision",
        "1m_context",
        "effort_max",
      ],
    },
    {
      id: "claude-sonnet-4-5-20250929",
      aliases: ["claude-sonnet-4-5"],
      displayName: "Claude Sonnet 4.5",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      pricing: {
        promptUsdPer1M: 3.0,
        completionUsdPer1M: 15.0,
        cacheReadUsdPer1M: 0.3,
        cacheWriteUsdPer1M: 3.75,
      },
      status: "active",
      releaseDate: "2025-09-29",
      sunsetDate: "2026-09-29",
      capabilities: ["extended_thinking", "vision"],
    },
    {
      id: "claude-sonnet-4-20250514",
      aliases: ["claude-sonnet-4-0"],
      displayName: "Claude Sonnet 4",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      pricing: {
        promptUsdPer1M: 3.0,
        completionUsdPer1M: 15.0,
        cacheReadUsdPer1M: 0.3,
        cacheWriteUsdPer1M: 3.75,
      },
      status: "deprecated",
      releaseDate: "2025-05-14",
      sunsetDate: "2026-06-15",
      capabilities: ["extended_thinking", "vision"],
    },
    {
      id: "claude-haiku-4-5-20251001",
      aliases: ["claude-haiku-4-5", "haiku"],
      displayName: "Claude Haiku 4.5",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      pricing: {
        promptUsdPer1M: 1.0,
        completionUsdPer1M: 5.0,
        cacheReadUsdPer1M: 0.1,
        cacheWriteUsdPer1M: 1.25,
      },
      status: "active",
      releaseDate: "2025-10-01",
      sunsetDate: "2026-10-15",
      capabilities: ["extended_thinking", "vision"],
    },
  ],
};

/**
 * Look up a model entry by id-or-alias.
 *
 * Returns the canonical entry whose `id` matches (case-insensitive) or whose
 * `aliases` includes the input. Returns `null` for unknown inputs (callers
 * decide whether to fall back to the alias as the resolved ID).
 *
 * Pure function — testable in isolation. Used by `model-resolver.ts`.
 */
export function findAnthropicModel(
  idOrAlias: string,
  catalog: AnthropicCatalog = ANTHROPIC_CATALOG_SNAPSHOT,
): AnthropicModelEntry | null {
  const needle = idOrAlias.trim().toLowerCase();
  if (!needle) return null;
  for (const m of catalog.models) {
    if (m.id.toLowerCase() === needle) return m;
    for (const a of m.aliases) {
      if (a.toLowerCase() === needle) return m;
    }
  }
  return null;
}
