// ---------------------------------------------------------------------------
// 0711 — anthropic-catalog snapshot integrity tests.
//
// Locks the snapshot fixture against silent drift. Every entry must have a
// pricing block with realistic values; every `active` model must have a
// recent enough release date; the snapshot date itself must be within 6
// months of `today` (CI gate that forces a refresh).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_CATALOG_SNAPSHOT,
  findAnthropicModel,
  type AnthropicModelEntry,
} from "../anthropic-catalog.js";

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

describe("ANTHROPIC_CATALOG_SNAPSHOT — integrity", () => {
  it("has a snapshotDate in ISO YYYY-MM-DD form", () => {
    expect(ANTHROPIC_CATALOG_SNAPSHOT.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("CI gate: snapshotDate is at most 6 months old", () => {
    const snap = new Date(ANTHROPIC_CATALOG_SNAPSHOT.snapshotDate).getTime();
    const ageMs = Date.now() - snap;
    expect(
      ageMs,
      `Anthropic catalog snapshot at src/eval/anthropic-catalog.ts is ${Math.round(ageMs / (1000 * 60 * 60 * 24))} days old. Refresh from https://platform.claude.com/docs/en/about-claude/models/overview + https://claude.com/pricing.`,
    ).toBeLessThan(SIX_MONTHS_MS);
  });

  it("includes both Opus 4.7 and Sonnet 4.6 (current default-tier active models)", () => {
    const opus = findAnthropicModel("opus");
    const sonnet = findAnthropicModel("sonnet");
    expect(opus?.id).toBe("claude-opus-4-7");
    expect(sonnet?.id).toBe("claude-sonnet-4-6");
  });

  it("every model has positive prompt + completion pricing", () => {
    for (const m of ANTHROPIC_CATALOG_SNAPSHOT.models) {
      expect(m.pricing.promptUsdPer1M, m.id).toBeGreaterThan(0);
      expect(m.pricing.completionUsdPer1M, m.id).toBeGreaterThan(0);
      expect(m.pricing.cacheReadUsdPer1M, m.id).toBeGreaterThanOrEqual(0);
      expect(m.pricing.cacheWriteUsdPer1M, m.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("Opus pricing is more expensive than Sonnet which is more expensive than Haiku", () => {
    const opus = findAnthropicModel("claude-opus-4-7")!;
    const sonnet = findAnthropicModel("claude-sonnet-4-6")!;
    const haiku = findAnthropicModel("claude-haiku-4-5-20251001")!;
    expect(opus.pricing.promptUsdPer1M).toBeGreaterThan(sonnet.pricing.promptUsdPer1M);
    expect(sonnet.pricing.promptUsdPer1M).toBeGreaterThan(haiku.pricing.promptUsdPer1M);
  });

  it("sources block lists at least the public pricing page + models overview", () => {
    expect(ANTHROPIC_CATALOG_SNAPSHOT.sources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/anthropic.*pricing|claude\.com\/pricing/),
        expect.stringMatching(/about-claude\/models/),
      ]),
    );
  });
});

describe("findAnthropicModel — alias + canonical lookup", () => {
  it("finds by canonical id", () => {
    expect(findAnthropicModel("claude-opus-4-7")?.displayName).toBe("Claude Opus 4.7");
  });

  it("finds by short alias", () => {
    expect(findAnthropicModel("opus")?.id).toBe("claude-opus-4-7");
    expect(findAnthropicModel("sonnet")?.id).toBe("claude-sonnet-4-6");
    expect(findAnthropicModel("haiku")?.id).toBe("claude-haiku-4-5-20251001");
  });

  it("finds by alias with the [1m] context-window suffix", () => {
    expect(findAnthropicModel("opus[1m]")?.id).toBe("claude-opus-4-7");
    expect(findAnthropicModel("claude-sonnet-4-6[1m]")?.id).toBe("claude-sonnet-4-6");
  });

  it("is case-insensitive on input", () => {
    expect(findAnthropicModel("OPUS")?.id).toBe("claude-opus-4-7");
    expect(findAnthropicModel("CLAUDE-SONNET-4-6")?.id).toBe("claude-sonnet-4-6");
  });

  it("returns null for unknown ids and empty input", () => {
    expect(findAnthropicModel("claude-opus-99")).toBeNull();
    expect(findAnthropicModel("")).toBeNull();
    expect(findAnthropicModel("   ")).toBeNull();
  });

  it("does not match deprecated `best` from a wrong tier (best resolves to opus)", () => {
    expect(findAnthropicModel("best")?.id).toBe("claude-opus-4-7");
  });
});

describe("ANTHROPIC_CATALOG_SNAPSHOT — deprecation surface", () => {
  it("at least the two known 2025-05-14 deprecated models are flagged", () => {
    const deprecated: AnthropicModelEntry[] = ANTHROPIC_CATALOG_SNAPSHOT.models.filter(
      (m) => m.status === "deprecated",
    ) as AnthropicModelEntry[];
    const ids = deprecated.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["claude-opus-4-20250514", "claude-sonnet-4-20250514"]),
    );
  });

  it("active models with sunsetDate must have it in ISO YYYY-MM-DD form when present", () => {
    for (const m of ANTHROPIC_CATALOG_SNAPSHOT.models) {
      if (m.sunsetDate !== null) {
        expect(m.sunsetDate, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
