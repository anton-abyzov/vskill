// ---------------------------------------------------------------------------
// 0711 — model-resolver
//
// Single chokepoint that turns an alias / canonical id / env override into a
// fully-resolved record with provenance. Replaces the scattered
// `ANTHROPIC_NORMALIZE` lookups in llm.ts so that:
//   - `aiMeta.model` now records the concrete ID rather than the alias,
//     making "regenerated on Opus 4.6 vs 4.7" diffable.
//   - Pricing + display name come from a SINGLE catalog file; fixing one
//     stale ref no longer means hunting through three modules.
//   - ENV override (`VSKILL_DEFAULT_MODEL_ANTHROPIC`) lets early-access users
//     route plain `opus`/`sonnet`/`haiku` aliases to a not-yet-shipped model
//     without code changes.
//
// Pure function. Server + browser safe (no node:* imports). Server-side
// runtime catalog refresh lives in `catalog-fetcher.ts` (separate file) and
// is OPTIONAL — when offline, the dated snapshot is the source of truth.
// ---------------------------------------------------------------------------

import {
  ANTHROPIC_CATALOG_SNAPSHOT,
  findAnthropicModel,
  type AnthropicCatalog,
  type AnthropicModelEntry,
  type AnthropicPricing,
} from "./anthropic-catalog.js";

export type ModelResolutionSource = "snapshot" | "env-override" | "passthrough";

export interface ResolvedAnthropicModel {
  /** What the caller asked for, verbatim — useful for forensic logging. */
  requestedAlias: string;
  /** Canonical Anthropic API ID after resolution. */
  resolvedId: string;
  /** Marketing display name, or empty when source === "passthrough". */
  displayName: string;
  /** Pricing block when known; null when source === "passthrough". */
  pricing: AnthropicPricing | null;
  /** Where this answer came from. */
  source: ModelResolutionSource;
  /** ISO date of the catalog snapshot used. Always populated. */
  snapshotDate: string;
  /** Status from the catalog (active/deprecated/retired) when known. */
  status: AnthropicModelEntry["status"] | null;
  /** Sunset date from the catalog when known. */
  sunsetDate: string | null;
}

export interface ResolveOptions {
  /** Inject a custom catalog (for tests). Defaults to the dated snapshot. */
  catalog?: AnthropicCatalog;
  /** Inject a custom env getter (for tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

const PLAIN_ALIASES = new Set(["opus", "sonnet", "haiku", "best"]);

function passthrough(
  requestedAlias: string,
  catalog: AnthropicCatalog,
): ResolvedAnthropicModel {
  return {
    requestedAlias,
    resolvedId: requestedAlias,
    displayName: "",
    pricing: null,
    source: "passthrough",
    snapshotDate: catalog.snapshotDate,
    status: null,
    sunsetDate: null,
  };
}

function fromCatalog(
  requestedAlias: string,
  entry: AnthropicModelEntry,
  source: ModelResolutionSource,
  catalog: AnthropicCatalog,
): ResolvedAnthropicModel {
  return {
    requestedAlias,
    resolvedId: entry.id,
    displayName: entry.displayName,
    pricing: entry.pricing,
    source,
    snapshotDate: catalog.snapshotDate,
    status: entry.status,
    sunsetDate: entry.sunsetDate,
  };
}

/**
 * Resolve an Anthropic alias / canonical ID into a provenance-rich record.
 *
 * Precedence:
 *   1. ENV override `VSKILL_DEFAULT_MODEL_ANTHROPIC` — only when the input is
 *      a plain alias (`opus|sonnet|haiku|best`) so explicit canonical IDs
 *      always win over a tuned default.
 *   2. Catalog lookup — alias OR canonical ID, case-insensitive.
 *   3. Passthrough — unknown future ID; keep the input as `resolvedId`,
 *      record `source: "passthrough"` so the UI can warn about pricing
 *      and the test suite can flag missing entries.
 */
export function resolveAnthropicModel(
  input: string,
  opts: ResolveOptions = {},
): ResolvedAnthropicModel {
  const catalog = opts.catalog ?? ANTHROPIC_CATALOG_SNAPSHOT;
  const env = opts.env ?? process.env;
  const requestedAlias = input ?? "";
  const trimmed = requestedAlias.trim();
  if (!trimmed) return passthrough(requestedAlias, catalog);

  // 1. ENV override only kicks in for plain aliases — explicit canonical IDs
  //    are honoured exactly as the caller wrote them.
  const isPlainAlias = PLAIN_ALIASES.has(trimmed.toLowerCase());
  const overrideRaw = env.VSKILL_DEFAULT_MODEL_ANTHROPIC;
  const override = typeof overrideRaw === "string" ? overrideRaw.trim() : "";
  if (isPlainAlias && override) {
    const overrideEntry = findAnthropicModel(override, catalog);
    if (overrideEntry) {
      return fromCatalog(requestedAlias, overrideEntry, "env-override", catalog);
    }
    // Override is a future ID we do not know yet — preserve provenance and
    // signal that the snapshot is stale.
    return {
      requestedAlias,
      resolvedId: override,
      displayName: "",
      pricing: null,
      source: "env-override",
      snapshotDate: catalog.snapshotDate,
      status: null,
      sunsetDate: null,
    };
  }

  // 2. Catalog lookup.
  const entry = findAnthropicModel(trimmed, catalog);
  if (entry) return fromCatalog(requestedAlias, entry, "snapshot", catalog);

  // 3. Passthrough.
  return passthrough(trimmed, catalog);
}
