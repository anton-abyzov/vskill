import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock node:fs — only existsSync is used by findProjectRoot
// ---------------------------------------------------------------------------
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { findProjectRoot, PROJECT_MARKERS } = await import("./project-root.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockExistsSync to return true only for paths
 * that are in the `existing` set.
 */
function setExistingPaths(existing: Set<string>): void {
  mockExistsSync.mockImplementation((p: string) => existing.has(p));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findProjectRoot", () => {
  // TC-001: Finds .git at parent when cwd is subdirectory
  it("finds .git at parent when cwd is a subdirectory", () => {
    const projectDir = "/home/user/project";
    const startDir = join(projectDir, "src", "components");

    setExistingPaths(new Set([join(projectDir, ".git")]));

    expect(findProjectRoot(startDir)).toBe(projectDir);
  });

  // TC-002: Finds package.json at ancestor
  it("finds package.json at ancestor directory", () => {
    const projectDir = "/home/user/project";
    const startDir = join(projectDir, "deep", "nested", "dir");

    setExistingPaths(new Set([join(projectDir, "package.json")]));

    expect(findProjectRoot(startDir)).toBe(projectDir);
  });

  // TC-003: Returns null when no markers anywhere
  it("returns null when no markers exist anywhere up to root", () => {
    setExistingPaths(new Set());

    expect(findProjectRoot("/some/random/path")).toBeNull();
  });

  // TC-004: Nearest wins when markers at multiple levels
  it("returns nearest directory when markers exist at multiple levels", () => {
    const outer = "/home/user/project";
    const inner = join(outer, "submodule");
    const startDir = join(inner, "src");

    setExistingPaths(
      new Set([join(outer, ".git"), join(inner, ".git")])
    );

    expect(findProjectRoot(startDir)).toBe(inner);
  });

  // TC-005: Returns cwd itself when it has markers
  it("returns cwd itself when it contains markers", () => {
    const startDir = "/home/user/project";

    setExistingPaths(new Set([join(startDir, ".git")]));

    expect(findProjectRoot(startDir)).toBe(startDir);
  });

  // Additional: verifies all markers are recognized
  it("recognizes every marker in PROJECT_MARKERS", () => {
    for (const marker of PROJECT_MARKERS) {
      vi.clearAllMocks();
      const dir = "/home/user/project";
      setExistingPaths(new Set([join(dir, marker)]));

      expect(findProjectRoot(dir)).toBe(dir);
    }
  });
});
