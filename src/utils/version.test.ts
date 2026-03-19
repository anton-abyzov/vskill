import { describe, it, expect } from "vitest";
import {
  extractFrontmatterVersion,
  bumpPatch,
  resolveVersion,
} from "./version.js";

// ---------------------------------------------------------------------------
// extractFrontmatterVersion
// ---------------------------------------------------------------------------
describe("extractFrontmatterVersion", () => {
  it("returns version from YAML frontmatter", () => {
    const content = [
      "---",
      "name: my-skill",
      "version: 2.1.0",
      "---",
      "# My Skill",
    ].join("\n");

    expect(extractFrontmatterVersion(content)).toBe("2.1.0");
  });

  it("returns undefined when no version field exists", () => {
    const content = [
      "---",
      "name: my-skill",
      "---",
      "# My Skill",
    ].join("\n");

    expect(extractFrontmatterVersion(content)).toBeUndefined();
  });

  it("returns undefined for invalid semver value", () => {
    const content = [
      "---",
      "version: not-semver",
      "---",
      "# My Skill",
    ].join("\n");

    expect(extractFrontmatterVersion(content)).toBeUndefined();
  });

  it("handles quoted version strings", () => {
    const content = [
      "---",
      'version: "3.0.0"',
      "---",
      "# My Skill",
    ].join("\n");

    expect(extractFrontmatterVersion(content)).toBe("3.0.0");
  });
});

// ---------------------------------------------------------------------------
// bumpPatch
// ---------------------------------------------------------------------------
describe("bumpPatch", () => {
  it("increments patch version from 1.0.0 to 1.0.1", () => {
    expect(bumpPatch("1.0.0")).toBe("1.0.1");
  });

  it("increments patch version from 1.2.5 to 1.2.6", () => {
    expect(bumpPatch("1.2.5")).toBe("1.2.6");
  });

  it("returns 1.0.1 for non-semver input", () => {
    expect(bumpPatch("invalid")).toBe("1.0.1");
  });
});

// ---------------------------------------------------------------------------
// resolveVersion
// ---------------------------------------------------------------------------
describe("resolveVersion", () => {
  it("uses serverVersion when provided (highest priority)", () => {
    const result = resolveVersion({
      serverVersion: "5.0.0",
      frontmatterVersion: "3.0.0",
      currentVersion: "1.0.0",
      hashChanged: true,
      isFirstInstall: false,
    });

    expect(result).toBe("5.0.0");
  });

  it("uses frontmatter version when no server version", () => {
    const result = resolveVersion({
      frontmatterVersion: "3.0.0",
      currentVersion: "1.0.0",
      hashChanged: true,
      isFirstInstall: false,
    });

    expect(result).toBe("3.0.0");
  });

  it("auto-patches when hash changed and no explicit version", () => {
    const result = resolveVersion({
      currentVersion: "1.0.0",
      hashChanged: true,
      isFirstInstall: false,
    });

    expect(result).toBe("1.0.1");
  });

  it("keeps current version when hash unchanged", () => {
    const result = resolveVersion({
      currentVersion: "1.0.0",
      hashChanged: false,
      isFirstInstall: false,
    });

    expect(result).toBe("1.0.0");
  });

  it("defaults to 1.0.0 on first install with no versions", () => {
    const result = resolveVersion({
      hashChanged: false,
      isFirstInstall: true,
    });

    expect(result).toBe("1.0.0");
  });
});
