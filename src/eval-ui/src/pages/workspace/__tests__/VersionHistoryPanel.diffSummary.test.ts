// 0781 AC-US3: formatDiffSummary maps the platform's empty-publish strings
// to a friendlier explainer. All other strings pass through unchanged.

import { describe, it, expect } from "vitest";
import { formatDiffSummary } from "../VersionHistoryPanel";

describe("formatDiffSummary (0781 US-003)", () => {
  it("AC-US3-01: '0 files' → 'Metadata-only release — no file changes'", () => {
    expect(formatDiffSummary("0 files")).toBe(
      "Metadata-only release — no file changes",
    );
  });

  it("AC-US3-01: case-insensitive — '0 Files' is matched", () => {
    expect(formatDiffSummary("0 Files")).toBe(
      "Metadata-only release — no file changes",
    );
  });

  it("AC-US3-01: 'no file changes' → friendlier label", () => {
    expect(formatDiffSummary("no file changes")).toBe(
      "Metadata-only release — no file changes",
    );
  });

  it("AC-US3-01: trims surrounding whitespace before matching", () => {
    expect(formatDiffSummary("  0 files  ")).toBe(
      "Metadata-only release — no file changes",
    );
  });

  it("AC-US3-02: legitimate summaries pass through unchanged", () => {
    expect(formatDiffSummary("Synced SKILL.md from standalone repo")).toBe(
      "Synced SKILL.md from standalone repo",
    );
  });

  it("AC-US3-02: '+1 new, ~2 modified' is not rewritten", () => {
    expect(formatDiffSummary("+1 new, ~2 modified")).toBe(
      "+1 new, ~2 modified",
    );
  });

  it("AC-US3-02: '0 files added' (legitimate, contains '0 files' as substring) is NOT rewritten", () => {
    // The matcher requires an exact (trimmed/lowercased) string equality so
    // a legitimate diff that happens to start with "0 files" is preserved.
    expect(formatDiffSummary("0 files added but readme grew")).toBe(
      "0 files added but readme grew",
    );
  });

  it("AC-US3-03: null/undefined/empty → empty string", () => {
    expect(formatDiffSummary(null)).toBe("");
    expect(formatDiffSummary(undefined)).toBe("");
    expect(formatDiffSummary("")).toBe("");
    expect(formatDiffSummary("   ")).toBe("");
  });
});
