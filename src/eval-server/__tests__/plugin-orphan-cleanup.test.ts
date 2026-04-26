// ---------------------------------------------------------------------------
// 0767 — Tests for the orphan-cache cleanup helper used by the uninstall
// route. When `claude plugin uninstall <name>` reports "not found in
// installed plugins" but the marketplace cache still holds an orphaned
// `<cacheRoot>/<marketplace>/<name>/` directory, we want to clean it up so
// the Studio sidebar stops surfacing the ghost plugin on the next scan.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  listOrphanPluginCacheDirs,
  removeOrphanPluginCacheDirs,
} from "../plugin-orphan-cleanup";

let cacheRoot: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "vskill-orphan-test-"));
});

afterEach(() => {
  if (existsSync(cacheRoot)) {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

function seed(p: string): void {
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "marker.txt"), "orphan");
}

describe("listOrphanPluginCacheDirs (0767)", () => {
  it("finds matching plugin dirs across all marketplaces", () => {
    seed(join(cacheRoot, "claude-plugins-official", "skill-creator", "78497c524da3"));
    seed(join(cacheRoot, "second-mp", "skill-creator", "abc123"));
    seed(join(cacheRoot, "claude-plugins-official", "other-plugin", "v1"));

    const result = listOrphanPluginCacheDirs("skill-creator", cacheRoot);

    expect(result.sort()).toEqual(
      [
        join(cacheRoot, "claude-plugins-official", "skill-creator"),
        join(cacheRoot, "second-mp", "skill-creator"),
      ].sort(),
    );
  });

  it("returns [] when the plugin name doesn't appear under any marketplace", () => {
    seed(join(cacheRoot, "claude-plugins-official", "other-plugin", "v1"));
    expect(listOrphanPluginCacheDirs("skill-creator", cacheRoot)).toEqual([]);
  });

  it("returns [] when cacheRoot doesn't exist", () => {
    const missing = join(cacheRoot, "nope");
    expect(listOrphanPluginCacheDirs("skill-creator", missing)).toEqual([]);
  });

  it("rejects path-traversal attempts in the plugin name", () => {
    seed(join(cacheRoot, "..", "evil-target"));
    seed(join(cacheRoot, "claude-plugins-official", "skill-creator", "v1"));

    // ../-style names must not escape cacheRoot.
    expect(listOrphanPluginCacheDirs("../evil-target", cacheRoot)).toEqual([]);
    // Absolute paths must not escape either.
    expect(listOrphanPluginCacheDirs("/etc/passwd", cacheRoot)).toEqual([]);
  });

  it("ignores files under cacheRoot that aren't directories (no marketplace folders)", () => {
    writeFileSync(join(cacheRoot, "stray.txt"), "loose file");
    seed(join(cacheRoot, "real-mp", "skill-creator", "v1"));

    const result = listOrphanPluginCacheDirs("skill-creator", cacheRoot);
    expect(result).toEqual([join(cacheRoot, "real-mp", "skill-creator")]);
  });

  it("only lists when the plugin path resolves inside cacheRoot (defense in depth)", () => {
    // Construct a name that contains a separator — must not match anything
    // outside the safe (marketplace, plugin) two-segment shape.
    seed(join(cacheRoot, "mp", "skill-creator", "v1"));
    expect(listOrphanPluginCacheDirs(`..${sep}evil`, cacheRoot)).toEqual([]);
  });
});

describe("removeOrphanPluginCacheDirs (0767)", () => {
  it("removes each provided directory recursively", () => {
    const a = join(cacheRoot, "mp1", "skill-creator");
    const b = join(cacheRoot, "mp2", "skill-creator");
    seed(join(a, "78497c524da3"));
    seed(join(b, "abc"));

    const result = removeOrphanPluginCacheDirs([a, b], cacheRoot);

    expect(result.removed.sort()).toEqual([a, b].sort());
    expect(result.failed).toEqual([]);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
    // Marketplace dirs themselves are left intact (only the plugin sub-dir is removed).
    expect(existsSync(join(cacheRoot, "mp1"))).toBe(true);
  });

  it("refuses to remove paths outside cacheRoot", () => {
    const outside = join(cacheRoot, "..", "should-not-touch");
    seed(outside);

    const result = removeOrphanPluginCacheDirs([outside], cacheRoot);

    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toBe(outside);
    expect(existsSync(outside)).toBe(true);

    // cleanup the test escape directory
    rmSync(outside, { recursive: true, force: true });
  });

  it("collects per-path failures without aborting the batch", () => {
    const ok = join(cacheRoot, "mp1", "skill-creator");
    const bad = join(cacheRoot, "..", "evil");
    seed(join(ok, "v1"));
    seed(bad);

    const result = removeOrphanPluginCacheDirs([ok, bad], cacheRoot);

    expect(result.removed).toEqual([ok]);
    expect(result.failed.map((f) => f.path)).toEqual([bad]);
    expect(existsSync(ok)).toBe(false);
    expect(existsSync(bad)).toBe(true);

    rmSync(bad, { recursive: true, force: true });
  });

  it("is a no-op for an empty input list", () => {
    const result = removeOrphanPluginCacheDirs([], cacheRoot);
    expect(result.removed).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
