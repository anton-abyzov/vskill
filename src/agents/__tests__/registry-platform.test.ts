import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// 0706 T-002 & T-003: verify the agents-registry uses function-based
// detectInstalled (so Windows `cmd.exe` doesn't choke on `which`) and that
// the consumer in detectInstalledAgents() handles both legacy string and
// new function shapes.

const mockExec = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, exec: mockExec };
});

vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util");
  return {
    ...actual,
    promisify: (_fn: unknown) =>
      (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          try {
            resolve(mockExec(...args));
          } catch (err) {
            reject(err);
          }
        }),
  };
});

// The registry reads from node:fs inside the copilot detect function.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  };
});

const { AGENTS_REGISTRY } = await import("../agents-registry.js");

describe("agents-registry platform-aware detectInstalled (0706 T-002)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("every non-remote-only entry uses a function for detectInstalled", () => {
    for (const agent of AGENTS_REGISTRY) {
      if (agent.isRemoteOnly) continue;
      expect(
        typeof agent.detectInstalled,
        `agent ${agent.id} should have a function detectInstalled`,
      ).toBe("function");
    }
  });

  it("claude-code entry uses `which claude` on darwin and `where claude` on win32", async () => {
    const claude = AGENTS_REGISTRY.find((a) => a.id === "claude-code")!;
    expect(typeof claude.detectInstalled).toBe("function");
    const detect = claude.detectInstalled as () => Promise<boolean>;

    // darwin branch
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExec.mockReset();
    mockExec.mockReturnValueOnce({ stdout: "/usr/local/bin/claude", stderr: "" });
    await detect();
    expect(mockExec).toHaveBeenCalledWith("which claude");

    // win32 branch
    Object.defineProperty(process, "platform", { value: "win32" });
    mockExec.mockReset();
    mockExec.mockReturnValueOnce({ stdout: "C:\\bin\\claude.exe", stderr: "" });
    await detect();
    expect(mockExec).toHaveBeenCalledWith("where claude");
  });

  it("returns false when `which`/`where` fails", async () => {
    const codex = AGENTS_REGISTRY.find((a) => a.id === "codex")!;
    const detect = codex.detectInstalled as () => Promise<boolean>;

    Object.defineProperty(process, "platform", { value: "linux" });
    mockExec.mockImplementationOnce(() => {
      throw new Error("not found");
    });

    const result = await detect();
    expect(result).toBe(false);
  });
});

describe("copilot detection (0706 T-003)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    // default: code is on PATH
    mockExec.mockImplementation(() => ({ stdout: "/usr/bin/code", stderr: "" }));
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns true when `code` is on PATH AND github.copilot-* dir exists", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const copilot = AGENTS_REGISTRY.find((a) => a.id === "github-copilot-ext")!;
    const detect = copilot.detectInstalled as () => Promise<boolean>;

    mockExistsSync.mockImplementation((p: string) => p.includes(".vscode/extensions"));
    mockReaddirSync.mockReturnValueOnce([
      "some.other-ext-1.0.0",
      "github.copilot-1.234.0",
    ]);

    const result = await detect();
    expect(result).toBe(true);
  });

  it("returns false when no github.copilot-* directory exists", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const copilot = AGENTS_REGISTRY.find((a) => a.id === "github-copilot-ext")!;
    const detect = copilot.detectInstalled as () => Promise<boolean>;

    mockExistsSync.mockImplementation((p: string) => p.includes(".vscode/extensions"));
    mockReaddirSync.mockReturnValueOnce(["some.other-ext-1.0.0"]);

    const result = await detect();
    expect(result).toBe(false);
  });

  it("returns false when `code` is not on PATH (regardless of extensions dir)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const copilot = AGENTS_REGISTRY.find((a) => a.id === "github-copilot-ext")!;
    const detect = copilot.detectInstalled as () => Promise<boolean>;

    mockExec.mockReset();
    mockExec.mockImplementation(() => {
      throw new Error("not found");
    });
    // extensions dir could exist but it doesn't matter
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["github.copilot-1.234.0"]);

    const result = await detect();
    expect(result).toBe(false);
  });

  it("returns false when extensions dir does not exist", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const copilot = AGENTS_REGISTRY.find((a) => a.id === "github-copilot-ext")!;
    const detect = copilot.detectInstalled as () => Promise<boolean>;

    mockExistsSync.mockReturnValue(false);

    const result = await detect();
    expect(result).toBe(false);
  });
});
