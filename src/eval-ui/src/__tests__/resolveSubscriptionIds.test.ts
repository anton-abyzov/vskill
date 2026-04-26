// ---------------------------------------------------------------------------
// Unit tests for resolveSubscriptionIds (AC-US3-01, AC-US3-02 — 0736)
//
// The helper maps an installed-skill list to UUID/slug pairs that UpdateHub
// accepts. Skills with neither UUID nor slug are silently omitted — the
// polling fallback covers them (FR-005).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveSubscriptionIds } from "../utils/resolveSubscriptionIds";

describe("resolveSubscriptionIds", () => {
  it("AC-US3-01: returns uuid when skill has uuid but no slug", () => {
    const result = resolveSubscriptionIds([
      { plugin: ".claude", skill: "greet-anton", uuid: "abc-123" },
    ]);
    expect(result).toEqual([{ uuid: "abc-123" }]);
  });

  it("AC-US3-01: returns slug when skill has slug but no uuid", () => {
    const result = resolveSubscriptionIds([
      { plugin: ".claude", skill: "greet-anton", slug: "sk_published_acme/repo/greet-anton" },
    ]);
    expect(result).toEqual([{ slug: "sk_published_acme/repo/greet-anton" }]);
  });

  it("AC-US3-01: returns both uuid and slug when skill has both", () => {
    const result = resolveSubscriptionIds([
      {
        plugin: ".claude",
        skill: "greet-anton",
        uuid: "abc-123",
        slug: "sk_published_a/b/c",
      },
    ]);
    expect(result).toEqual([{ uuid: "abc-123", slug: "sk_published_a/b/c" }]);
  });

  it("AC-US3-02: omits skills with neither uuid nor slug", () => {
    const result = resolveSubscriptionIds([
      { plugin: ".claude", skill: "local-only" },
    ]);
    expect(result).toEqual([]);
  });

  it("AC-US3-02: omits skills with empty string uuid and no slug", () => {
    const result = resolveSubscriptionIds([
      { plugin: ".claude", skill: "no-platform", uuid: "", slug: "" },
    ]);
    expect(result).toEqual([]);
  });

  it("AC-US3-02: mixed list — only valid entries are returned", () => {
    const result = resolveSubscriptionIds([
      { plugin: ".claude", skill: "no-record" },
      { plugin: ".claude", skill: "has-uuid", uuid: "uuid-001" },
      { plugin: ".claude", skill: "has-slug", slug: "sk_published_x/y/z" },
      { plugin: ".claude", skill: "has-both", uuid: "uuid-002", slug: "sk_published_p/q/r" },
      { plugin: ".claude", skill: "empty-both", uuid: "", slug: "" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ uuid: "uuid-001" });
    expect(result[1]).toEqual({ slug: "sk_published_x/y/z" });
    expect(result[2]).toEqual({ uuid: "uuid-002", slug: "sk_published_p/q/r" });
  });

  it("returns empty array for empty input", () => {
    expect(resolveSubscriptionIds([])).toEqual([]);
  });

  it("builds correct flat CSV-ready list — only valid IDs from each entry", () => {
    const resolved = resolveSubscriptionIds([
      { plugin: ".claude", skill: "a", uuid: "u1", slug: "sk_published_a/b/c" },
      { plugin: ".claude", skill: "b", uuid: "u2" },
    ]);
    // Flatten to all IDs as useSkillUpdates would do
    const ids = resolved.flatMap((r) => [r.uuid, r.slug].filter(Boolean) as string[]);
    expect(ids).toEqual(["u1", "sk_published_a/b/c", "u2"]);
  });
});
