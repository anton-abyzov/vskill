// ---------------------------------------------------------------------------
// Tests for isValidSemver — covers AC-US4-02 examples + boundary cases.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { isValidSemver } from "../semver";

describe("isValidSemver", () => {
  it.each([
    "1.0.0",
    "0.0.0",
    "10.20.30",
    "2.1.3-beta.1",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-rc.1",
    "1.0.0+build.1",
    "1.0.0-alpha+exp.sha.5114f85",
    "1.2.3-0.3.7",
  ])("accepts valid semver: %s", (input) => {
    expect(isValidSemver(input)).toBe(true);
  });

  it.each([
    "",
    "1",
    "1.0",
    "1.0.0.0",
    "v1.0.0",
    "1.0.0-",
    "01.0.0",
    "1.0.0-01",
    "1.2.3 alpha",
    "abc",
  ])("rejects invalid semver: %s", (input) => {
    expect(isValidSemver(input)).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidSemver(null)).toBe(false);
    expect(isValidSemver(undefined)).toBe(false);
    expect(isValidSemver(1)).toBe(false);
    expect(isValidSemver({})).toBe(false);
  });

  it("trims whitespace before validating", () => {
    expect(isValidSemver("  1.0.0  ")).toBe(true);
  });
});
