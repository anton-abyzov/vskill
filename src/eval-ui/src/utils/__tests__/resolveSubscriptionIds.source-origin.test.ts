// ---------------------------------------------------------------------------
// 0838 T-007: resolveSubscriptionIds — source-origin matching (AC-US2-01, AC-US2-05)
//
// Source-origin skills (locally authored, `origin === "source"`) carry no
// platform UUID/slug in their installed-skill record. The new
// `includeSourceOriginMatches: true` option asks the resolver to match
// these skills to a registry twin by `(name, author)` via a batch lookup
// helper passed in as `lookup`. Match key contract: case-insensitive
// `name`, exact `author`. Entries without an `author` are silently
// excluded from the lookup (no error).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import {
  resolveSubscriptionIds,
  resolveSubscriptionIdsWithSourceOrigin,
  type SourceOriginEntry,
} from "../resolveSubscriptionIds";

describe("resolveSubscriptionIds — source-origin (T-007)", () => {
  it("ignores source-origin entries when includeSourceOriginMatches=false (default)", () => {
    const installed = [
      { plugin: ".claude", skill: "x", uuid: "u1" },
    ];
    // Existing path is unchanged: the helper returns the installed-uuid only.
    const result = resolveSubscriptionIds(installed);
    expect(result).toEqual([{ uuid: "u1" }]);
  });

  it("merges source-origin matches when includeSourceOriginMatches=true", async () => {
    const installed = [
      { plugin: ".claude", skill: "x", uuid: "u1" },
    ];
    const sourceOrigin: SourceOriginEntry[] = [
      {
        plugin: ".claude",
        skill: "hi-anton",
        origin: "source",
        author: "Anton",
        localVersion: "1.0.0",
      },
    ];

    const lookup = vi.fn(async (entries: Array<{ name: string; author: string }>) => {
      // Sanity: the helper sent us only entries with an author.
      expect(entries).toEqual([{ name: "hi-anton", author: "Anton" }]);
      return [{ name: "hi-anton", author: "Anton", uuid: "u-hi" }];
    });

    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed,
      sourceOrigin,
      lookup,
    });

    expect(result).toContainEqual({ uuid: "u1" });
    expect(result).toContainEqual({ uuid: "u-hi" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("excludes source-origin entries with no author from the lookup batch", async () => {
    const sourceOrigin: SourceOriginEntry[] = [
      {
        plugin: ".claude",
        skill: "no-author",
        origin: "source",
        // author intentionally omitted
        localVersion: "1.0.0",
      },
      {
        plugin: ".claude",
        skill: "with-author",
        origin: "source",
        author: "Anton",
        localVersion: "1.0.0",
      },
    ];

    const lookup = vi.fn(async (entries: Array<{ name: string; author: string }>) => {
      expect(entries).toEqual([{ name: "with-author", author: "Anton" }]);
      return [{ name: "with-author", author: "Anton", uuid: "u-w" }];
    });

    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed: [],
      sourceOrigin,
      lookup,
    });

    expect(result).toEqual([{ uuid: "u-w" }]);
  });

  it("silently excludes source-origin entries that match no registry twin", async () => {
    const sourceOrigin: SourceOriginEntry[] = [
      {
        plugin: ".claude",
        skill: "no-twin",
        origin: "source",
        author: "Anton",
        localVersion: "1.0.0",
      },
    ];

    const lookup = vi.fn(async () => {
      // Empty result — no twin in the registry.
      return [];
    });

    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed: [],
      sourceOrigin,
      lookup,
    });

    expect(result).toEqual([]);
    expect(lookup).toHaveBeenCalled();
  });

  it("skips lookup entirely when source-origin list is empty", async () => {
    const lookup = vi.fn();
    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed: [{ plugin: ".claude", skill: "x", uuid: "u1" }],
      sourceOrigin: [],
      lookup,
    });
    expect(result).toEqual([{ uuid: "u1" }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not throw and returns installed-only result when lookup rejects", async () => {
    const sourceOrigin: SourceOriginEntry[] = [
      {
        plugin: ".claude",
        skill: "hi",
        origin: "source",
        author: "Anton",
        localVersion: "1.0.0",
      },
    ];

    const lookup = vi.fn(async () => {
      throw new Error("network");
    });

    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed: [{ plugin: ".claude", skill: "x", uuid: "u1" }],
      sourceOrigin,
      lookup,
    });

    expect(result).toEqual([{ uuid: "u1" }]);
  });

  it("includes slug when the lookup result returns slug instead of uuid", async () => {
    const sourceOrigin: SourceOriginEntry[] = [
      {
        plugin: ".claude",
        skill: "slug-only",
        origin: "source",
        author: "Anton",
        localVersion: "1.0.0",
      },
    ];

    const lookup = vi.fn(async () => [
      { name: "slug-only", author: "Anton", slug: "sk_published_a/b/c" },
    ]);

    const result = await resolveSubscriptionIdsWithSourceOrigin({
      installed: [],
      sourceOrigin,
      lookup,
    });

    expect(result).toEqual([{ slug: "sk_published_a/b/c" }]);
  });
});
