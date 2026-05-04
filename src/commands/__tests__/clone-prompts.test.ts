// ---------------------------------------------------------------------------
// Unit tests for src/commands/clone-prompts.ts — confirmPrompt (US-003).
//
// Coverage:
//   AC-US3-01: confirmPrompt({yes: true}) returns true without reading stdin
//   AC-US3-02: confirmPrompt({stdinIsTTY: false}) returns false + stderr msg
//   AC-US3-03: confirmPrompt({stdinIsTTY: true}) exercises the readline path
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  type RlInstance = {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  const lastInstance = { value: null as RlInstance | null };
  const cannedAnswer = { value: "" };
  const createInterface = vi.fn(() => {
    const inst: RlInstance = {
      question: vi.fn((_q: string, cb: (answer: string) => void) => {
        cb(cannedAnswer.value);
      }),
      close: vi.fn(),
    };
    lastInstance.value = inst;
    return inst;
  });
  return { createInterface, lastInstance, cannedAnswer };
});

vi.mock("node:readline", () => ({
  createInterface: mocks.createInterface,
}));

import { confirmPrompt } from "../clone-prompts.js";

let stderrSpy: ReturnType<typeof vi.spyOn>;
const stderrChunks: string[] = [];

beforeEach(() => {
  mocks.createInterface.mockClear();
  mocks.lastInstance.value = null;
  mocks.cannedAnswer.value = "";
  stderrChunks.length = 0;
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("confirmPrompt", () => {
  it("returns true without reading stdin when {yes: true} (AC-US3-01)", async () => {
    const result = await confirmPrompt("Proceed?", { yes: true });
    expect(result).toBe(true);
    expect(mocks.createInterface).not.toHaveBeenCalled();
  });

  it("returns false and writes no-TTY error when {stdinIsTTY: false} (AC-US3-02)", async () => {
    const result = await confirmPrompt("Proceed?", { stdinIsTTY: false });
    expect(result).toBe(false);
    expect(mocks.createInterface).not.toHaveBeenCalled();
    const combinedStderr = stderrChunks.join("");
    expect(combinedStderr).toContain(
      "refusing to prompt in non-TTY context — re-run with --yes to confirm",
    );
  });

  it("exercises readline path when {stdinIsTTY: true} (AC-US3-03)", async () => {
    mocks.cannedAnswer.value = "y";
    const result = await confirmPrompt("Proceed?", { stdinIsTTY: true });
    expect(result).toBe(true);
    expect(mocks.createInterface).toHaveBeenCalledOnce();
    expect(mocks.lastInstance.value?.question).toHaveBeenCalledOnce();
    expect(mocks.lastInstance.value?.close).toHaveBeenCalledOnce();
  });
});
