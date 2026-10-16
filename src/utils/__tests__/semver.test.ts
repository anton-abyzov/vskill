import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion } from "../semver.js";

describe("compareVersions", () => {
  it("compares patch numbers as numbers, not text (3.0.14 > 3.0.6)", () => {
    expect(compareVersions("3.0.14", "3.0.6")).toBeGreaterThan(0);
    expect(compareVersions("3.0.6", "3.0.14")).toBeLessThan(0);
    expect(["2.3.0", "3.0.14", "3.0.6"].sort(compareVersions).pop()).toBe("3.0.14");
  });

  it("orders major and minor before patch", () => {
    expect(compareVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.10.0", "1.9.12")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("puts a pre-release below its release", () => {
    expect(compareVersions("3.0.0-beta.1", "3.0.0")).toBeLessThan(0);
    expect(compareVersions("3.0.0-beta.10", "3.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0-alpha", "3.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("3.0.0-1", "3.0.0-alpha")).toBeLessThan(0);
    expect(compareVersions("3.0.0-beta", "3.0.0-beta.1")).toBeLessThan(0);
  });

  it("ignores build metadata", () => {
    expect(compareVersions("1.0.0+abc", "1.0.0+def")).toBe(0);
  });

  it("sorts non-versions below versions", () => {
    expect(compareVersions("latest", "0.0.1")).toBeLessThan(0);
    expect(compareVersions("0.0.1", "latest")).toBeGreaterThan(0);
    expect(compareVersions("abc", "abd")).toBeLessThan(0);
  });
});

describe("parseVersion", () => {
  it("parses release and pre-release versions", () => {
    expect(parseVersion("3.0.14")).toEqual({ major: 3, minor: 0, patch: 14, pre: [] });
    expect(parseVersion("1.2.3-rc.1")).toEqual({ major: 1, minor: 2, patch: 3, pre: ["rc", "1"] });
  });

  it("rejects anything that is not major.minor.patch", () => {
    expect(parseVersion("3.0")).toBeNull();
    expect(parseVersion("unknown")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});
