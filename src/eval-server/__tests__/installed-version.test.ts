// ---------------------------------------------------------------------------
// 0764: pickInstalledVersion — precedence chain (lockfile > frontmatter >
// content-hash match) for the /api/skills/:plugin/:skill/versions endpoint
// `isInstalled` enrichment.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { pickInstalledVersion, sha256Hex } from "../installed-version.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const VERSIONS = [
  { version: "1.0.3", contentHash: HASH_A },
  { version: "1.0.2", contentHash: "sha256:pending:abc" }, // sentinel — ignored
  { version: "1.0.1", contentHash: HASH_B },
  { version: "1.0.0", contentHash: HASH_C },
];

describe("0764 pickInstalledVersion", () => {
  it("AC-US1-01 — frontmatter version matching an upstream row → returns that version", () => {
    // Given a skill with frontmatter version 1.0.2 and no lockfile entry
    // When pickInstalledVersion runs
    // Then it returns 1.0.2 (the matching upstream row)
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: null,
      frontmatterVersion: "1.0.2",
      onDiskContentHash: null,
    });
    expect(result).toBe("1.0.2");
  });

  it("AC-US1-02 — no frontmatter, content-hash matches an upstream row → returns matching version", () => {
    // Given an on-disk SKILL.md whose hash matches upstream 1.0.0's contentHash
    // And no frontmatter version, no lockfile entry
    // When pickInstalledVersion runs
    // Then it returns 1.0.0
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: null,
      frontmatterVersion: null,
      onDiskContentHash: HASH_C,
    });
    expect(result).toBe("1.0.0");
  });

  it("AC-US1-03 — no signal matches → returns null", () => {
    // Given no lockfile, frontmatter version not in upstream list, no hash match
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: null,
      frontmatterVersion: "9.9.9",
      onDiskContentHash: "deadbeef".repeat(8),
    });
    expect(result).toBeNull();
  });

  it("AC-US1-04 — lockfile entry takes precedence over both fallbacks", () => {
    // Given a lockfile says 1.0.1, frontmatter says 1.0.2, hash matches 1.0.0
    // Then lockfile wins → 1.0.1
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: "1.0.1",
      frontmatterVersion: "1.0.2",
      onDiskContentHash: HASH_C,
    });
    expect(result).toBe("1.0.1");
  });

  it("lockfile-only path returns the lockfile version even when not in upstream list", () => {
    // Existing behavior preserved: lockfile version is reported even if the
    // upstream list doesn't contain it (e.g. yanked release). The caller
    // decides whether to render it.
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: "0.9.0",
      frontmatterVersion: null,
      onDiskContentHash: null,
    });
    expect(result).toBe("0.9.0");
  });

  it("ignores sentinel sha256:pending: hashes during contentHash match", () => {
    // 1.0.2's contentHash is "sha256:pending:abc". An on-disk hash of "abc"
    // (after sentinel-stripping) must NOT match — sentinel rows are ignored
    // entirely.
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: null,
      frontmatterVersion: null,
      onDiskContentHash: "abc",
    });
    expect(result).toBeNull();
  });

  it("contentHash match is case-insensitive", () => {
    // Upstream row stored lowercase, on-disk hash uppercase — should match.
    const result = pickInstalledVersion({
      versions: [{ version: "2.0.0", contentHash: HASH_A.toLowerCase() }],
      lockfileVersion: null,
      frontmatterVersion: null,
      onDiskContentHash: HASH_A.toUpperCase(),
    });
    expect(result).toBe("2.0.0");
  });

  it("frontmatter that does NOT match any upstream row returns null (not a guess)", () => {
    // We refuse to claim the user is on a published version they're not on.
    const result = pickInstalledVersion({
      versions: VERSIONS,
      lockfileVersion: null,
      frontmatterVersion: "5.5.5",
      onDiskContentHash: null,
    });
    expect(result).toBeNull();
  });
});

describe("0764 sha256Hex", () => {
  it("returns a 64-char lowercase hex digest", () => {
    const h = sha256Hex("hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Spot-check known value (sha256("hello world"))
    expect(h).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});
