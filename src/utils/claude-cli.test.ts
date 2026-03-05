import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const {
  isClaudeCliAvailable,
  registerMarketplace,
  deregisterMarketplace,
  listMarketplaces,
  installNativePlugin,
  uninstallNativePlugin,
} = await import("./claude-cli.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isClaudeCliAvailable
// ---------------------------------------------------------------------------
describe("isClaudeCliAvailable", () => {
  it("returns true when claude binary exists", () => {
    mockExecSync.mockReturnValue(Buffer.from("1.0.0"));
    expect(isClaudeCliAvailable()).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith("claude --version", {
      stdio: "ignore",
      timeout: 5_000,
    });
  });

  it("returns false when claude binary is not found", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(isClaudeCliAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerMarketplace
// ---------------------------------------------------------------------------
describe("registerMarketplace", () => {
  it("returns success result with correct path", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    const result = registerMarketplace("/path/to/repo");
    expect(result).toEqual({ success: true });
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "/path/to/repo"',
      { stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
    );
  });

  it("returns failure result with stderr on error", () => {
    const err = new Error("failed") as Error & { stderr: Buffer };
    err.stderr = Buffer.from("marketplace not found");
    mockExecSync.mockImplementation(() => { throw err; });
    const result = registerMarketplace("/path/to/repo");
    expect(result).toEqual({ success: false, stderr: "marketplace not found" });
  });

  it("returns failure with error message when no stderr", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("command failed");
    });
    const result = registerMarketplace("/path/to/repo");
    expect(result).toEqual({ success: false, stderr: "command failed" });
  });

  it("quotes paths with spaces", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    registerMarketplace("/path/with spaces/repo");
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "/path/with spaces/repo"',
      expect.any(Object),
    );
  });

  it("accepts GitHub HTTPS URL as source", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    const result = registerMarketplace("https://github.com/owner/repo");
    expect(result).toEqual({ success: true });
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "https://github.com/owner/repo"',
      { stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
    );
  });

  it("accepts GitHub owner/repo shorthand as source", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    const result = registerMarketplace("owner/repo");
    expect(result).toEqual({ success: true });
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "owner/repo"',
      { stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// deregisterMarketplace
// ---------------------------------------------------------------------------
describe("deregisterMarketplace", () => {
  it("calls claude plugin marketplace remove", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(deregisterMarketplace("https://github.com/owner/repo")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace remove "https://github.com/owner/repo"',
      { stdio: "ignore", timeout: 10_000 },
    );
  });

  it("returns false on failure", () => {
    mockExecSync.mockImplementation(() => { throw new Error("fail"); });
    expect(deregisterMarketplace("https://github.com/owner/repo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listMarketplaces
// ---------------------------------------------------------------------------
describe("listMarketplaces", () => {
  it("parses marketplace list output", () => {
    mockExecSync.mockReturnValue(Buffer.from("https://github.com/a/b\nhttps://github.com/c/d\n"));
    expect(listMarketplaces()).toEqual(["https://github.com/a/b", "https://github.com/c/d"]);
  });

  it("returns empty array on failure", () => {
    mockExecSync.mockImplementation(() => { throw new Error("fail"); });
    expect(listMarketplaces()).toEqual([]);
  });

  it("returns empty array for empty output", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(listMarketplaces()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// installNativePlugin
// ---------------------------------------------------------------------------
describe("installNativePlugin", () => {
  it("defaults to project scope", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(installNativePlugin("frontend", "vskill")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin install "frontend@vskill" --scope project',
      { stdio: "ignore", timeout: 30_000 },
    );
  });

  it("passes --scope project explicitly", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(installNativePlugin("frontend", "vskill", "project")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin install "frontend@vskill" --scope project',
      { stdio: "ignore", timeout: 30_000 },
    );
  });

  it("omits scope flag for user scope", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(installNativePlugin("sw", "specweave", "user")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin install "sw@specweave"',
      { stdio: "ignore", timeout: 30_000 },
    );
  });

  it("returns false when command fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("failed");
    });
    expect(installNativePlugin("frontend", "vskill")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// uninstallNativePlugin
// ---------------------------------------------------------------------------
describe("uninstallNativePlugin", () => {
  it("calls claude plugin uninstall with plugin@marketplace format", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(uninstallNativePlugin("frontend", "vskill")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin uninstall "frontend@vskill"',
      { stdio: "ignore", timeout: 10_000 },
    );
  });

  it("returns false when command fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("failed");
    });
    expect(uninstallNativePlugin("frontend", "vskill")).toBe(false);
  });
});
