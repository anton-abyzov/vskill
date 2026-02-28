import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const {
  isClaudeCliAvailable,
  registerMarketplace,
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
  it("calls claude plugin marketplace add with correct path", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(registerMarketplace("/path/to/repo")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "/path/to/repo"',
      { stdio: "ignore", timeout: 15_000 },
    );
  });

  it("returns false when command fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("failed");
    });
    expect(registerMarketplace("/path/to/repo")).toBe(false);
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
    expect(registerMarketplace("https://github.com/owner/repo")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "https://github.com/owner/repo"',
      { stdio: "ignore", timeout: 15_000 },
    );
  });

  it("accepts GitHub owner/repo shorthand as source", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(registerMarketplace("owner/repo")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin marketplace add "owner/repo"',
      { stdio: "ignore", timeout: 15_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// installNativePlugin
// ---------------------------------------------------------------------------
describe("installNativePlugin", () => {
  it("calls claude plugin install with plugin@marketplace format", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    expect(installNativePlugin("frontend", "vskill")).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'claude plugin install "frontend@vskill"',
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
