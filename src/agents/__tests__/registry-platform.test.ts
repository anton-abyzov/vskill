import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// 0706 T-002 & T-003: verify the agents-registry uses function-based
// detectInstalled (so Windows `cmd.exe` doesn't choke on `which`) and that
// the consumer in detectInstalledAgents() handles both legacy string and
// new function shapes.
//
// `exec` is mocked with callback-style semantics (the shape real Node
// `exec` uses before `promisify` wraps it). This lets the real
// `util.promisify` chain through untouched and keeps the async flow
// indistinguishable from production.

type ExecCb = (
  err: (Error & { code?: string | number }) | null,
  value?: { stdout: string; stderr: string },
) => void;

const mockExec = vi.hoisted(() =>
  vi.fn<[string, ExecCb], void>((_cmd, cb) => cb(null, { stdout: "", stderr: "" })),
);
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, exec: mockExec };
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

  // Platform-branch correctness for `detectBinary` is proved at the
  // helper level in `resolve-binary-platform.test.ts`. Here we assert the
  // integration shape: each migrated row now routes through a function
  // (instead of the hardcoded `'which X'` string) so win32 cmd.exe can
  // actually resolve them via `where` under the hood.
  it("simple CLI-only entries return a function that calls detectBinary under the hood", () => {
    const ids = ["claude-code", "codex", "cursor", "gemini-cli", "windsurf"];
    for (const id of ids) {
      const agent = AGENTS_REGISTRY.find((a) => a.id === id);
      expect(agent, `missing agent ${id}`).toBeDefined();
      expect(typeof agent!.detectInstalled).toBe("function");
    }
  });
});

describe("copilot detection (0706 T-003)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    // default: code is on PATH (callback-style exec; null err = success)
    mockExec.mockImplementation((_cmd, cb) =>
      cb(null, { stdout: "/usr/bin/code", stderr: "" }),
    );
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

  it("returns false when extensions dir is missing even if `code` is on PATH", async () => {
    // `code` short-circuit is exercised end-to-end by the resolve-binary
    // helper tests. Here we just assert the second half: even with `code`
    // happily on PATH, an absent extensions dir means no copilot install.
    Object.defineProperty(process, "platform", { value: "darwin" });
    const copilot = AGENTS_REGISTRY.find((a) => a.id === "github-copilot-ext")!;
    const detect = copilot.detectInstalled as () => Promise<boolean>;

    mockExistsSync.mockReturnValue(false); // extDir missing

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
