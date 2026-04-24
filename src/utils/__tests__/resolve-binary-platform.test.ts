import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 0706 T-001: platform-aware binary detection helpers.
// Tests buildDetectCommand() (sync, string builder) and detectBinary()
// (async wrapper that runs the built command via execAsync).
//
// `exec` is the callback-style child_process primitive; `promisify(exec)`
// wraps it to accept `(cmd, options)` and return a Promise. To test
// without spawning real processes, we mock `exec` with callback semantics:
// success → invoke callback with `(null, {stdout, stderr})`; failure →
// invoke with `(err)`. Real `promisify` is left untouched.

type ExecCb = (
  err: (Error & { code?: string }) | null,
  value?: { stdout: string; stderr: string },
) => void;

const mockExec = vi.hoisted(() =>
  vi.fn<[string, ExecCb], void>((_cmd, cb) => cb(null, { stdout: "", stderr: "" })),
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, exec: mockExec };
});

const { buildDetectCommand, detectBinary } = await import(
  "../resolve-binary.js"
);

describe("buildDetectCommand (0706 T-001)", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns 'where <bin>' on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(buildDetectCommand("node")).toBe("where node");
  });

  it("returns 'which <bin>' on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(buildDetectCommand("node")).toBe("which node");
  });

  it("returns 'which <bin>' on linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(buildDetectCommand("claude")).toBe("which claude");
  });
});

describe("detectBinary (0706 T-001)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns true when exec resolves", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExec.mockImplementationOnce((_cmd, cb) =>
      cb(null, { stdout: "/usr/local/bin/node", stderr: "" }),
    );

    const result = await detectBinary("node");

    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith("which node", expect.any(Function));
  });

  it("returns false when exec rejects (binary not found)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExec.mockImplementationOnce((_cmd, cb) =>
      cb(Object.assign(new Error("not found"), { code: 1 })),
    );

    const result = await detectBinary("definitely-not-a-real-bin-xyzzy");

    expect(result).toBe(false);
  });

  it("uses 'where' on win32", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockExec.mockImplementationOnce((_cmd, cb) =>
      cb(null, { stdout: "C:\\foo\\node.exe", stderr: "" }),
    );

    const result = await detectBinary("node");

    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith("where node", expect.any(Function));
  });
});
