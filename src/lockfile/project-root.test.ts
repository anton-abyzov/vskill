import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { findProjectRoot, getProjectRoot } = await import(
  "./project-root.js"
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "vskill-fpr-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  it("returns null when no .specweave/config.json exists", () => {
    expect(findProjectRoot(tmpDir)).toBeNull();
  });

  it("finds root when .specweave/config.json is in startDir", () => {
    mkdirSync(join(tmpDir, ".specweave"), { recursive: true });
    writeFileSync(join(tmpDir, ".specweave", "config.json"), "{}");
    expect(findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it("finds root from a nested subdirectory", () => {
    mkdirSync(join(tmpDir, ".specweave"), { recursive: true });
    writeFileSync(join(tmpDir, ".specweave", "config.json"), "{}");
    const nested = join(tmpDir, "src", "commands", "deep");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(tmpDir);
  });

  it("returns null for stale .specweave without config.json", () => {
    mkdirSync(join(tmpDir, ".specweave"), { recursive: true });
    // No config.json — stale folder
    expect(findProjectRoot(tmpDir)).toBeNull();
  });

  it("does not throw when startDir is omitted", () => {
    const result = findProjectRoot();
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

describe("getProjectRoot", () => {
  it("returns found root when .specweave/config.json exists", () => {
    mkdirSync(join(tmpDir, ".specweave"), { recursive: true });
    writeFileSync(join(tmpDir, ".specweave", "config.json"), "{}");
    expect(getProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it("falls back to process.cwd() when no root found", () => {
    expect(getProjectRoot(tmpDir)).toBe(process.cwd());
  });
});
