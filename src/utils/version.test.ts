import { describe, it, expect } from "vitest";
import {
  extractFrontmatterVersion,
  setFrontmatterVersion,
  readFrontmatterVersion,
  bumpPatch,
  resolveVersion,
} from "./version.js";

// ---------------------------------------------------------------------------
// extractFrontmatterVersion
// ---------------------------------------------------------------------------
describe("extractFrontmatterVersion", () => {
  it("reads single-quoted metadata versions, including after an invalid legacy version", () => {
    const content = "---\nversion: unknown\nmetadata:\n  version: '2.3.4' # release\n---\nBody";
    expect(extractFrontmatterVersion(content)).toBe("2.3.4");
    expect(readFrontmatterVersion(content)).toBe("unknown");
  });

  it("does not mistake a different mapping or deeper child for metadata.version", () => {
    expect(extractFrontmatterVersion("---\nmetadata:\n  author: example\nruntime:\n  version: 9.0.0\n---")).toBeUndefined();
    expect(extractFrontmatterVersion("---\nmetadata:\n  details:\n    version: 9.0.0\n---")).toBeUndefined();
  });
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

describe("portable version writes", () => {
  it("updates metadata without disturbing adjacent fields, multiline values, or CRLF", () => {
    const content = "---\r\nname: example\r\nmetadata:\r\n  author: example\r\n  version: '1.0.0'\r\n  note: |\r\n    Keep $& and $` literal.\r\nlicense: MIT\r\n---\r\nBody $&";
    const updated = setFrontmatterVersion(content, "1.0.1");
    expect(updated).toBe(content.replace("  version: '1.0.0'", '  version: "1.0.1"'));
    expect(extractFrontmatterVersion(updated)).toBe("1.0.1");
    expect(setFrontmatterVersion(updated, "1.0.1")).toBe(updated);
  });

  it("inserts into an existing metadata mapping without replacing its other fields", () => {
    const content = "---\nname: example\nmetadata:\n  author: example\nlicense: MIT\n---\nBody";
    expect(setFrontmatterVersion(content, "1.0.0")).toBe(content.replace("metadata:\n", 'metadata:\n  version: "1.0.0"\n'));
  });

  it("refuses to create duplicate metadata when given an unsupported inline mapping", () => {
    expect(() => setFrontmatterVersion("---\nmetadata: {author: example}\n---\nBody", "1.0.0"))
      .toThrow("metadata must use a block mapping");
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
