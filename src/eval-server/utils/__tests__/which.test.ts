// ---------------------------------------------------------------------------
// which.test.ts — shared `whichSync` helper.
//
// The default whichSync shells out and is hard to pin in tests, so we mostly
// exercise whichSyncWith (the injectable variant) for behavioral coverage.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { whichSync, whichSyncWith, _resetWhichCacheForTests } from "../which.js";

describe("whichSyncWith — input validation", () => {
  it("accepts simple alphanumeric names", () => {
    expect(whichSyncWith("code", () => true)).toBe(true);
    expect(whichSyncWith("git", () => true)).toBe(true);
  });

  it("accepts dots, dashes, underscores", () => {
    expect(whichSyncWith("my-tool", () => true)).toBe(true);
    expect(whichSyncWith("tool.exe", () => true)).toBe(true);
    expect(whichSyncWith("my_tool", () => true)).toBe(true);
  });

  it("rejects empty input without invoking probe", () => {
    let called = false;
    expect(
      whichSyncWith("", () => {
        called = true;
        return true;
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });

  it("rejects shell metacharacters without invoking probe", () => {
    let called = false;
    const probe = () => {
      called = true;
      return true;
    };
    expect(whichSyncWith("foo;rm", probe)).toBe(false);
    expect(whichSyncWith("foo bar", probe)).toBe(false);
    expect(whichSyncWith("foo|bar", probe)).toBe(false);
    expect(whichSyncWith("foo$(x)", probe)).toBe(false);
    expect(whichSyncWith("../escape", probe)).toBe(false);
    expect(called).toBe(false);
  });

  it("returns the probe's result when input is safe", () => {
    expect(whichSyncWith("code", () => true)).toBe(true);
    expect(whichSyncWith("code", () => false)).toBe(false);
  });
});

describe("whichSync — caching contract", () => {
  beforeEach(() => {
    _resetWhichCacheForTests();
  });

  it("returns false for unsafe input synchronously", () => {
    expect(whichSync("evil; ls")).toBe(false);
    expect(whichSync("")).toBe(false);
  });

  it("returns boolean for a real probe (no throw)", () => {
    // We can't pin the underlying probe, but the contract guarantees a
    // boolean result for any safe input.
    expect(typeof whichSync("definitely-not-a-real-binary-xyz123")).toBe("boolean");
  });
});
