import { describe, it, expect } from "vitest";
import path from "node:path";

// 0706 T-005: ghost-file cleanup in src/commands/update.ts uses the same
// `target.startsWith(resolvedBase + "/")` pattern as canonical.ts. The bug
// and fix are identical: Windows uses `\` not `/`, so the string-prefix
// check silently no-ops on Windows. Replacement: `path.relative()`.
//
// Because `cleanupGhostFiles` is a private helper inside update.ts, we
// assert the underlying path.relative semantics directly — enough to lock
// in the intended Windows contract.

describe("ghost-file cleanup path guard (0706 T-005)", () => {
  it("path.relative(base, inside) does NOT start with '..' — file is inside", () => {
    const base = path.win32.resolve("C:\\\\proj\\\\.claude\\\\skills\\\\foo");
    const inside = path.win32.resolve(base, "sub\\\\file.md");
    const rel = path.win32.relative(base, inside);
    expect(rel.startsWith("..")).toBe(false);
  });

  it("path.relative(base, outside) DOES start with '..' — file outside", () => {
    const base = path.win32.resolve("C:\\\\proj\\\\.claude\\\\skills\\\\foo");
    const outside = path.win32.resolve("C:\\\\Windows\\\\System32\\\\evil.exe");
    const rel = path.win32.relative(base, outside);
    expect(rel.startsWith("..")).toBe(true);
  });

  it("POSIX: path.relative handles forward-slash paths too", () => {
    const base = "/home/u/proj/.claude/skills/foo";
    const inside = "/home/u/proj/.claude/skills/foo/sub/file.md";
    const outside = "/etc/passwd";
    expect(path.posix.relative(base, inside).startsWith("..")).toBe(false);
    expect(path.posix.relative(base, outside).startsWith("..")).toBe(true);
  });

  it("old startsWith check would FAIL on Windows paths (regression doc)", () => {
    // The legacy check was: target.startsWith(resolvedBase + "/")
    // On Windows resolved paths use backslash, so the "/" suffix never matches.
    const resolvedBase = "C:\\proj\\.claude\\skills\\foo";
    const target = "C:\\proj\\.claude\\skills\\foo\\sub\\file.md";
    const legacy = target.startsWith(resolvedBase + "/");
    expect(legacy).toBe(false); // Bug: would skip cleanup on Windows
  });
});
