import { describe, expect, it } from "vitest";
import { compareSemver } from "../compareSemver";

describe("compareSemver precedence", () => {
  const ordered = [
    "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
    "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0",
  ];
  it.each(ordered.slice(1).map((version, i) => [ordered[i], version]))("orders %s before %s", (a, b) => {
    expect(compareSemver(a, b)).toBe(-1);
    expect(compareSemver(b, a)).toBe(1);
  });

  it.each([
    ["1.0.0", "1.0.0+build.9"],
    ["1.0.0+build.9", "1.0.0+build.2"],
    ["1.0.0-rc.1+build.9", "1.0.0-rc.1+build.2"],
    [" 1.0.0 ", "1.0.0"],
  ])("ignores build metadata and outer whitespace: %s / %s", (a, b) => {
    expect(compareSemver(a, b)).toBe(0);
  });

  it.each([
    ["1.0.0-999", "1.0.0-a"],
    ["1.0.0-a-2", "1.0.0-a-9"],
    ["1.0.0-Z", "1.0.0-a"],
    ["1.0.0-9007199254740992", "1.0.0-9007199254740993"],
    ["9007199254740992.0.0", "9007199254740993.0.0"],
  ])("preserves numeric and lexical identifier precedence: %s / %s", (a, b) => {
    expect(compareSemver(a, b)).toBe(-1);
    expect(compareSemver(b, a)).toBe(1);
  });

  it.each(["", "latest", "v1.0.0", "1.0", "01.0.0", "1.0.0-01", "1.0.0+", "1.0.0-a..b"])("leaves invalid version %s unordered", (invalid) => {
    expect(compareSemver(invalid, "1.0.0")).toBeNull();
    expect(compareSemver("1.0.0", invalid)).toBeNull();
  });
});
