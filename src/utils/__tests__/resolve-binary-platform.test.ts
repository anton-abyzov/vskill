import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 0706 T-001: platform-aware binary detection helpers.
// Tests buildDetectCommand() (sync, string builder) and detectBinary()
// (async wrapper that runs the built command via execAsync).

const mockExec = vi.hoisted(() => vi.fn());
const mockPromisify = vi.hoisted(() => vi.fn((fn: unknown) => {
  // Return a function that calls mockExec and returns a promise
  return (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      try {
        const out = mockExec(...args);
        resolve(out);
      } catch (err) {
        reject(err);
      }
    });
  };
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, exec: mockExec };
});

vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util");
  return { ...actual, promisify: mockPromisify };
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
    mockExec.mockReturnValueOnce({ stdout: "/usr/local/bin/node", stderr: "" });

    const result = await detectBinary("node");

    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith("which node");
  });

  it("returns false when exec rejects (binary not found)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExec.mockImplementationOnce(() => {
      throw new Error("not found");
    });

    const result = await detectBinary("definitely-not-a-real-bin-xyzzy");

    expect(result).toBe(false);
  });

  it("uses 'where' on win32", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockExec.mockReturnValueOnce({ stdout: "C:\\foo\\node.exe", stderr: "" });

    const result = await detectBinary("node");

    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith("where node");
  });
});
