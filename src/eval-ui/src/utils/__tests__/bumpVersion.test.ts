// ---------------------------------------------------------------------------
// 0759 Phase 7 — bumpVersion + validateVersionTransition tests.
//
// Pure helpers backing the studio's manual-bump UI and the no-jump enforcement
// applied at Save time. The platform's publish.ts already enforces strict
// monotonicity at submission; the studio adds a friendlier client-side guard
// so authors can't accidentally jump 1.0.5 → 5.0.0 in the textarea and only
// hear about it after `vskill publish`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { bumpVersion, validateVersionTransition } from "../bumpVersion";

describe("bumpVersion", () => {
  it("patch bump: 1.0.5 → 1.0.6", () => {
    expect(bumpVersion("1.0.5", "patch")).toBe("1.0.6");
  });

  it("minor bump: resets patch (1.0.5 → 1.1.0)", () => {
    expect(bumpVersion("1.0.5", "minor")).toBe("1.1.0");
  });

  it("major bump: resets minor + patch (1.0.5 → 2.0.0)", () => {
    expect(bumpVersion("1.0.5", "major")).toBe("2.0.0");
  });

  it("works on 0.x.y series", () => {
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "major")).toBe("1.0.0");
  });

  it("strips a leading 'v' if present", () => {
    expect(bumpVersion("v1.2.3", "patch")).toBe("1.2.4");
  });

  it("strips an optional pre-release / build metadata when bumping (cleanup)", () => {
    // We don't try to be clever about pre-release semantics — a plain bump
    // discards any -alpha / +meta suffix and produces a clean version.
    expect(bumpVersion("1.2.3-rc.1", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3+build.42", "minor")).toBe("1.3.0");
  });

  it("throws on non-semver input", () => {
    expect(() => bumpVersion("abc", "patch")).toThrow();
    expect(() => bumpVersion("", "patch")).toThrow();
    expect(() => bumpVersion("1.2", "patch")).toThrow();
  });
});

describe("validateVersionTransition", () => {
  it("identical version: valid (no-op save)", () => {
    expect(validateVersionTransition("1.0.5", "1.0.5").valid).toBe(true);
  });

  it("patch +1: valid", () => {
    expect(validateVersionTransition("1.0.5", "1.0.6").valid).toBe(true);
  });

  it("minor +1 with patch reset to 0: valid", () => {
    expect(validateVersionTransition("1.0.5", "1.1.0").valid).toBe(true);
  });

  it("major +1 with minor + patch reset to 0: valid", () => {
    expect(validateVersionTransition("1.0.5", "2.0.0").valid).toBe(true);
  });

  it("patch jump > 1 is rejected", () => {
    const r = validateVersionTransition("1.0.5", "1.0.7");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/patch.*increase by 1/i);
  });

  it("minor +2 is rejected", () => {
    const r = validateVersionTransition("1.0.5", "1.2.0");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/minor/i);
  });

  it("major jump is rejected (1.0.5 → 3.0.0)", () => {
    const r = validateVersionTransition("1.0.5", "3.0.0");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/major/i);
  });

  it("minor bump that does NOT reset patch is rejected (1.0.5 → 1.1.5)", () => {
    const r = validateVersionTransition("1.0.5", "1.1.5");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/patch.*reset|must be 0/i);
  });

  it("major bump that does NOT reset minor/patch is rejected (1.0.5 → 2.1.0)", () => {
    const r = validateVersionTransition("1.0.5", "2.1.0");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/(minor|patch).*reset|must be 0/i);
  });

  it("decreasing version is rejected", () => {
    const r = validateVersionTransition("1.2.0", "1.1.5");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/decrease|monotonic|backward/i);
  });

  it("invalid `to` value is rejected with a clear reason", () => {
    const r = validateVersionTransition("1.0.0", "abc");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/invalid|semver/i);
  });

  it("missing `from` (initial save without prior version) treats any valid version as fine", () => {
    expect(validateVersionTransition(null, "1.0.0").valid).toBe(true);
    expect(validateVersionTransition(null, "0.1.0").valid).toBe(true);
    // But still rejects garbage:
    expect(validateVersionTransition(null, "abc").valid).toBe(false);
  });
});
