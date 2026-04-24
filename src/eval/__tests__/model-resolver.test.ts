// ---------------------------------------------------------------------------
// 0711 — model-resolver tests.
//
// `resolveAnthropicModel(input, opts)` must collapse every legitimate way a
// caller can refer to an Anthropic model — alias, full ID, ENV override —
// into a single deterministic resolution record. Source precedence:
//   1. ENV override   (VSKILL_DEFAULT_MODEL_ANTHROPIC) when input is missing
//      OR when input is a plain alias (`opus`/`sonnet`/`haiku`) AND the env
//      override resolves to a known model
//   2. Catalog lookup (alias OR canonical id, case-insensitive)
//   3. Pass-through  (caller specified a concrete ID we do not yet know —
//      record the alias→id as identity, mark source: "passthrough", no
//      pricing block; UI can warn on >90d snapshot age)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAnthropicModel } from "../model-resolver.js";
import { ANTHROPIC_CATALOG_SNAPSHOT } from "../anthropic-catalog.js";

const ORIGINAL_ENV = process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC;

describe("resolveAnthropicModel — alias + id lookup", () => {
  beforeEach(() => {
    delete process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC;
  });
  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = ORIGINAL_ENV;
    else delete process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC;
  });

  it("resolves the bare 'opus' alias to claude-opus-4-7 (snapshot source)", () => {
    const r = resolveAnthropicModel("opus");
    expect(r.resolvedId).toBe("claude-opus-4-7");
    expect(r.displayName).toBe("Claude Opus 4.7");
    expect(r.source).toBe("snapshot");
    expect(r.pricing?.promptUsdPer1M).toBe(5.0);
    expect(r.snapshotDate).toBe(ANTHROPIC_CATALOG_SNAPSHOT.snapshotDate);
  });

  it("resolves a full canonical id straight through", () => {
    const r = resolveAnthropicModel("claude-haiku-4-5-20251001");
    expect(r.resolvedId).toBe("claude-haiku-4-5-20251001");
    expect(r.source).toBe("snapshot");
    expect(r.pricing?.promptUsdPer1M).toBe(1.0);
  });

  it("preserves the [1m] suffix on the requested alias for context-window provenance", () => {
    const r = resolveAnthropicModel("opus[1m]");
    expect(r.resolvedId).toBe("claude-opus-4-7");
    expect(r.requestedAlias).toBe("opus[1m]");
  });

  it("returns source='passthrough' for unknown future ids", () => {
    const r = resolveAnthropicModel("claude-opus-4-8-20260601");
    expect(r.resolvedId).toBe("claude-opus-4-8-20260601");
    expect(r.source).toBe("passthrough");
    expect(r.pricing).toBeNull();
  });

  it("returns source='passthrough' with null pricing when input is empty", () => {
    const r = resolveAnthropicModel("");
    expect(r.resolvedId).toBe("");
    expect(r.source).toBe("passthrough");
    expect(r.pricing).toBeNull();
    expect(r.displayName).toBe("");
  });
});

describe("resolveAnthropicModel — ENV override (VSKILL_DEFAULT_MODEL_ANTHROPIC)", () => {
  beforeEach(() => {
    delete process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC;
  });
  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = ORIGINAL_ENV;
    else delete process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC;
  });

  it("override wins for plain alias inputs (sonnet → custom model)", () => {
    process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = "claude-sonnet-4-5-20250929";
    const r = resolveAnthropicModel("sonnet");
    expect(r.resolvedId).toBe("claude-sonnet-4-5-20250929");
    expect(r.source).toBe("env-override");
    expect(r.requestedAlias).toBe("sonnet");
  });

  it("override does NOT clobber an explicit canonical ID", () => {
    process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = "claude-opus-4-7";
    const r = resolveAnthropicModel("claude-haiku-4-5-20251001");
    expect(r.resolvedId).toBe("claude-haiku-4-5-20251001");
    expect(r.source).toBe("snapshot");
  });

  it("override resolves through the catalog when its value is itself an alias", () => {
    process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = "haiku";
    const r = resolveAnthropicModel("opus");
    expect(r.resolvedId).toBe("claude-haiku-4-5-20251001");
    expect(r.source).toBe("env-override");
    expect(r.pricing?.promptUsdPer1M).toBe(1.0);
  });

  it("ignores empty / whitespace-only override values", () => {
    process.env.VSKILL_DEFAULT_MODEL_ANTHROPIC = "   ";
    const r = resolveAnthropicModel("opus");
    expect(r.resolvedId).toBe("claude-opus-4-7");
    expect(r.source).toBe("snapshot");
  });
});

describe("resolveAnthropicModel — provenance shape", () => {
  it("returns the snapshotDate so callers can persist provenance with the model", () => {
    const r = resolveAnthropicModel("opus");
    expect(r.snapshotDate).toBe(ANTHROPIC_CATALOG_SNAPSHOT.snapshotDate);
    expect(r.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preserves the original alias the caller used so generated artifacts can record it", () => {
    expect(resolveAnthropicModel("OPUS").requestedAlias).toBe("OPUS");
    expect(resolveAnthropicModel("claude-sonnet-4-6").requestedAlias).toBe("claude-sonnet-4-6");
  });
});
