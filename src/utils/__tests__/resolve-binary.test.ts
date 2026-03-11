import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockHomedir = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

const { resolveCliBinary, enhancedPath, clearResolveCache } = await import(
  "../resolve-binary.js"
);

describe("resolveCliBinary", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    clearResolveCache();
    mockHomedir.mockReturnValue("/home/testuser");
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("resolves via which on current PATH (strategy 1)", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/usr/local/bin/claude\n"));

    const result = resolveCliBinary("claude");

    expect(result).toBe("/usr/local/bin/claude");
    expect(mockExecSync).toHaveBeenCalledWith(
      "which claude",
      expect.objectContaining({ timeout: 3_000 }),
    );
  });

  it("caches resolved paths", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("/usr/local/bin/claude\n"));

    const first = resolveCliBinary("claude");
    const second = resolveCliBinary("claude");

    expect(first).toBe(second);
    // Only called once due to cache
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to login shell which when current PATH fails (strategy 2)", () => {
    // Strategy 1 fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });
    // Strategy 2 succeeds
    mockExecSync.mockReturnValueOnce(Buffer.from("/opt/homebrew/bin/claude\n"));
    mockExistsSync.mockImplementation((p: string) => p === "/opt/homebrew/bin/claude");

    const result = resolveCliBinary("claude");

    expect(result).toBe("/opt/homebrew/bin/claude");
  });

  it("falls back to npm global bin (strategy 3)", () => {
    // Strategy 1 fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });
    // Strategy 2 fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });
    // Strategy 3: npm config get prefix
    mockExecSync.mockReturnValueOnce(Buffer.from("/usr/local\n"));
    mockExistsSync.mockImplementation((p: string) => p === "/usr/local/bin/claude");

    const result = resolveCliBinary("claude");

    expect(result).toBe("/usr/local/bin/claude");
  });

  it("falls back to common paths (strategy 4)", () => {
    // All execSync calls fail
    mockExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    // /home/testuser/.local/bin/claude exists
    mockExistsSync.mockImplementation(
      (p: string) => p === "/home/testuser/.local/bin/claude",
    );

    const result = resolveCliBinary("claude");

    expect(result).toBe("/home/testuser/.local/bin/claude");
  });

  it("returns bare name when all strategies fail (strategy 5)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    mockExistsSync.mockReturnValue(false);

    const result = resolveCliBinary("claude");

    expect(result).toBe("claude");
  });

  it("uses where on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    clearResolveCache();
    mockExecSync.mockReturnValueOnce(
      Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd\n"),
    );

    const result = resolveCliBinary("claude");

    expect(result).toBe("C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd");
    expect(mockExecSync).toHaveBeenCalledWith(
      "where claude",
      expect.anything(),
    );
  });

  it("handles where returning multiple paths (Windows)", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    clearResolveCache();
    mockExecSync.mockReturnValueOnce(
      Buffer.from("C:\\first\\claude.cmd\nC:\\second\\claude.cmd\n"),
    );

    const result = resolveCliBinary("claude");

    expect(result).toBe("C:\\first\\claude.cmd");
  });

  it("skips login shell on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    clearResolveCache();
    // which fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("not found");
    });
    // npm config get prefix
    mockExecSync.mockReturnValueOnce(Buffer.from("C:\\Users\\test\\AppData\\Roaming\\npm\n"));
    mockExistsSync.mockImplementation(
      (p: string) => p === "C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd",
    );

    const result = resolveCliBinary("claude");

    // Should NOT have tried login shell (no `-lc` call)
    const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
    expect(calls).not.toContainEqual(expect.stringContaining("-lc"));
  });

  it("resolves different binaries independently", () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from("/usr/local/bin/claude\n"))
      .mockReturnValueOnce(Buffer.from("/usr/local/bin/codex\n"));

    const claude = resolveCliBinary("claude");
    const codex = resolveCliBinary("codex");

    expect(claude).toBe("/usr/local/bin/claude");
    expect(codex).toBe("/usr/local/bin/codex");
  });
});

describe("enhancedPath", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHomedir.mockReturnValue("/home/testuser");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns original PATH when no extra dirs exist", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    mockExistsSync.mockReturnValue(false);

    const result = enhancedPath("/usr/bin:/bin");

    expect(result).toBe("/usr/bin:/bin");
  });

  it("appends existing extra directories", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    mockExistsSync.mockImplementation(
      (p: string) => p === "/opt/homebrew/bin" || p === "/usr/local/bin",
    );

    const result = enhancedPath("/usr/bin");

    expect(result).toContain("/opt/homebrew/bin");
    expect(result).toContain("/usr/local/bin");
    expect(result.startsWith("/usr/bin:")).toBe(true);
  });

  it("does not duplicate paths already in PATH", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    mockExistsSync.mockImplementation((p: string) => p === "/usr/local/bin");

    const result = enhancedPath("/usr/bin:/usr/local/bin");

    // /usr/local/bin should appear only once
    const parts = result.split(":");
    const count = parts.filter((p) => p === "/usr/local/bin").length;
    expect(count).toBe(1);
  });

  it("uses process.env.PATH when no argument provided", () => {
    const origPath = process.env.PATH;
    process.env.PATH = "/test/path";
    mockExecSync.mockImplementation(() => {
      throw new Error("no npm");
    });
    mockExistsSync.mockReturnValue(false);

    const result = enhancedPath();

    expect(result).toBe("/test/path");
    process.env.PATH = origPath;
  });
});
