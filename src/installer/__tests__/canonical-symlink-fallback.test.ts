import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 0706 T-006: verify createRelativeSymlink()'s EPERM/EACCES handling.
// - EPERM/EACCES → log warning once (module-scoped), return false.
// - Other errors → propagate (no silent swallow).
// - Success → return true, no warning.

const mockSymlinkSync = vi.hoisted(() => vi.fn());
const mockLstatSync = vi.hoisted(() => vi.fn(() => ({
  isSymbolicLink: () => false,
  isDirectory: () => false,
})));
const mockRmSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    symlinkSync: mockSymlinkSync,
    lstatSync: mockLstatSync,
    rmSync: mockRmSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
  };
});

const { createRelativeSymlink, __resetSymlinkWarning } = await import(
  "../canonical.js"
);

describe("createRelativeSymlink (0706 T-006)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockLstatSync.mockImplementation(() => {
      const err: any = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    __resetSymlinkWarning();
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("returns true on successful symlink", () => {
    mockSymlinkSync.mockReturnValueOnce(undefined);
    const ok = createRelativeSymlink("/canonical/foo", "/agents/cursor/foo");
    expect(ok).toBe(true);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("returns false and warns exactly once when EPERM thrown", () => {
    const eperm: any = new Error("operation not permitted");
    eperm.code = "EPERM";
    mockSymlinkSync.mockImplementation(() => {
      throw eperm;
    });

    const ok1 = createRelativeSymlink("/canonical/foo", "/agents/cursor/foo");
    const ok2 = createRelativeSymlink("/canonical/bar", "/agents/codex/bar");

    expect(ok1).toBe(false);
    expect(ok2).toBe(false);
    // Warning emitted to stderr ONLY ONCE across multiple failures.
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Symlinks not available"),
    );
  });

  it("returns false and warns once on EACCES as well", () => {
    const eacces: any = new Error("permission denied");
    eacces.code = "EACCES";
    mockSymlinkSync.mockImplementation(() => {
      throw eacces;
    });

    const ok = createRelativeSymlink("/canonical/foo", "/agents/cursor/foo");
    expect(ok).toBe(false);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("returns false (and does NOT warn) on non-permission errors", () => {
    // Behavior contract: only EPERM/EACCES are user-actionable (the
    // Windows Developer Mode hint). For ENOENT/EIO/EEXIST etc. we preserve
    // prior "silent false" semantics so the caller's copy fallback still
    // runs — changing this would regress existing installers that rely on
    // the fallback path.
    const eio: any = new Error("I/O error");
    eio.code = "EIO";
    mockSymlinkSync.mockImplementation(() => {
      throw eio;
    });

    const ok = createRelativeSymlink("/canonical/foo", "/agents/cursor/foo");
    expect(ok).toBe(false);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("__resetSymlinkWarning makes the next EPERM warn again", () => {
    const eperm: any = new Error("operation not permitted");
    eperm.code = "EPERM";
    mockSymlinkSync.mockImplementation(() => {
      throw eperm;
    });

    createRelativeSymlink("/a", "/x");
    createRelativeSymlink("/a", "/y");
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    __resetSymlinkWarning();
    createRelativeSymlink("/a", "/z");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });
});
