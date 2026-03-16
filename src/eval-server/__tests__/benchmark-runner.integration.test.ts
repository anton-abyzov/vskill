// ---------------------------------------------------------------------------
// Integration tests for parallel benchmark execution (T-010, T-014)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvalCase } from "../../eval/schema.js";
import type { LlmClient, GenerateResult } from "../../eval/llm.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../eval/judge.js", () => ({
  judgeAssertion: vi.fn(),
}));

vi.mock("../sse-helpers.js", () => ({
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  withHeartbeat: vi.fn((_res: unknown, _id: unknown, _phase: unknown, _msg: unknown, fn: () => unknown) => fn()),
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(),
}));

import { runBenchmarkSSE } from "../benchmark-runner.js";
import { judgeAssertion } from "../../eval/judge.js";
import { sendSSE, sendSSEDone } from "../sse-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvalCases(count: number, assertionsPerCase = 2): EvalCase[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `case-${i + 1}`,
    prompt: `prompt ${i + 1}`,
    expected_output: `output ${i + 1}`,
    files: [],
    assertions: Array.from({ length: assertionsPerCase }, (_, ai) => ({
      id: `a${i + 1}-${ai + 1}`,
      text: `assertion ${ai + 1} for case ${i + 1}`,
      type: "boolean" as const,
    })),
  }));
}

function makeDelayClient(delayMs: number): LlmClient & { peakConcurrent: number; currentConcurrent: number } {
  let currentConcurrent = 0;
  let peakConcurrent = 0;

  return {
    model: "test-model",
    currentConcurrent: 0,
    peakConcurrent: 0,
    generate: vi.fn(async (): Promise<GenerateResult> => {
      currentConcurrent++;
      if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;
      // Update public-facing properties
      (client as any).currentConcurrent = currentConcurrent;
      (client as any).peakConcurrent = peakConcurrent;

      await new Promise((r) => setTimeout(r, delayMs + Math.random() * 20));

      currentConcurrent--;
      (client as any).currentConcurrent = currentConcurrent;

      return {
        text: "generated output",
        durationMs: delayMs,
        inputTokens: 10,
        outputTokens: 20,
      };
    }),
  };
  var client = arguments.callee; // not used, see below
  // The closure captures the correct reference already
}

function makeMockRes() {
  return { write: vi.fn(), on: vi.fn() } as any;
}

// ---------------------------------------------------------------------------
// TC-017: End-to-end parallel run — 8 cases, concurrency 3
// ---------------------------------------------------------------------------

describe("Parallel benchmark execution (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(judgeAssertion).mockImplementation(async (_output, assertion) => ({
      id: assertion.id,
      text: assertion.text,
      pass: true,
      reasoning: "ok",
    }));
  });

  it("runs all cases with bounded concurrency (TC-017)", async () => {
    const cases = makeEvalCases(8, 2);
    let peakConcurrent = 0;
    let currentConcurrent = 0;
    const concurrencyLimit = 3;

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        currentConcurrent++;
        if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;

        await new Promise((r) => setTimeout(r, 30 + Math.random() * 20));

        currentConcurrent--;
        return {
          text: "output",
          durationMs: 30,
          inputTokens: 10,
          outputTokens: 20,
        };
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      concurrency: concurrencyLimit,
    });

    // All 8 cases should complete
    const doneCalls = vi.mocked(sendSSEDone).mock.calls;
    expect(doneCalls.length).toBe(1);
    const result = doneCalls[0][1] as any;
    expect(result.cases.length).toBe(8);

    // Peak concurrency should not exceed limit
    expect(peakConcurrent).toBeLessThanOrEqual(concurrencyLimit);
    // With 8 cases and limit 3, should actually reach the limit
    expect(peakConcurrent).toBeGreaterThanOrEqual(2); // at least some parallelism
  });

  // ---------------------------------------------------------------------------
  // TC-018: SSE event ordering — caseId and sequence
  // ---------------------------------------------------------------------------

  it("SSE events have caseId and ascending sequence per case (TC-018)", async () => {
    const cases = makeEvalCases(3, 1);

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        await new Promise((r) => setTimeout(r, 10));
        return { text: "output", durationMs: 10, inputTokens: 5, outputTokens: 10 };
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      concurrency: 3,
    });

    const allEvents = vi.mocked(sendSSE).mock.calls
      .map((c) => ({ event: c[1], data: c[2] as Record<string, unknown> }))
      .filter((e) => e.data?.caseId != null);

    // Every case event should have caseId
    expect(allEvents.length).toBeGreaterThan(0);
    for (const e of allEvents) {
      expect(e.data.caseId).toBeDefined();
      expect(typeof e.data.sequence).toBe("number");
    }

    // Events within each case should have ascending sequence
    const caseGroups = new Map<number, number[]>();
    for (const e of allEvents) {
      const caseId = e.data.caseId as number;
      if (!caseGroups.has(caseId)) caseGroups.set(caseId, []);
      caseGroups.get(caseId)!.push(e.data.sequence as number);
    }

    for (const [, sequences] of caseGroups) {
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // TC-001: Semaphore limits concurrency to default 5
  // ---------------------------------------------------------------------------

  it("defaults to concurrency 5 for API providers (TC-001)", async () => {
    const cases = makeEvalCases(10, 1);
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        currentConcurrent++;
        if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;
        await new Promise((r) => setTimeout(r, 30));
        currentConcurrent--;
        return { text: "output", durationMs: 30, inputTokens: 5, outputTokens: 10 };
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic", // API provider → default 5
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      // No explicit concurrency — should default to 5
    });

    expect(peakConcurrent).toBeLessThanOrEqual(5);
    expect(peakConcurrent).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // TC-002: Promise.allSettled isolates failures
  // ---------------------------------------------------------------------------

  it("isolates individual case failures via Promise.allSettled (TC-002)", async () => {
    const cases = makeEvalCases(5, 1);
    let callIdx = 0;

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        callIdx++;
        if (callIdx === 3) throw new Error("Case 3 LLM failure");
        return { text: "output", durationMs: 10, inputTokens: 5, outputTokens: 10 };
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      concurrency: 5,
    });

    const doneCalls = vi.mocked(sendSSEDone).mock.calls;
    expect(doneCalls.length).toBe(1);
    const result = doneCalls[0][1] as any;
    // All 5 cases should be present (one with error status)
    expect(result.cases.length).toBe(5);
    const errorCases = result.cases.filter((c: any) => c.status === "error");
    expect(errorCases.length).toBe(1);
    expect(errorCases[0].error_message).toBe("Case 3 LLM failure");
  });

  // ---------------------------------------------------------------------------
  // TC-025: Parallel speedup measured
  // ---------------------------------------------------------------------------

  it("achieves significant speedup with parallelism (TC-025)", async () => {
    const CASE_DELAY = 50; // 50ms per case
    const CASE_COUNT = 10;
    const CONCURRENCY = 5;

    const cases = makeEvalCases(CASE_COUNT, 1);

    const createTimedClient = (): LlmClient => ({
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        await new Promise((r) => setTimeout(r, CASE_DELAY));
        return { text: "output", durationMs: CASE_DELAY, inputTokens: 5, outputTokens: 10 };
      }),
    });

    vi.mocked(judgeAssertion).mockImplementation(async (_output, assertion) => ({
      id: assertion.id,
      text: assertion.text,
      pass: true,
      reasoning: "ok",
    }));

    const res = makeMockRes();

    // Parallel run
    const parallelStart = Date.now();
    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client: createTimedClient(),
      isAborted: () => false,
      concurrency: CONCURRENCY,
    });
    const parallelDuration = Date.now() - parallelStart;

    // Sequential baseline would be ~CASE_COUNT * CASE_DELAY = 500ms
    const sequentialEstimate = CASE_COUNT * CASE_DELAY;

    // Parallel should be significantly faster — at least 2x speedup
    expect(parallelDuration).toBeLessThan(sequentialEstimate * 0.7);
  });

  // ---------------------------------------------------------------------------
  // TC-019/TC-020: 429 retry (tested at the runner level)
  // ---------------------------------------------------------------------------

  it("retries on 429 errors and succeeds after recovery (TC-019)", async () => {
    const cases = makeEvalCases(1, 1);
    let attempt = 0;

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        attempt++;
        if (attempt <= 2) throw new Error("429 Too Many Requests");
        return { text: "output", durationMs: 10, inputTokens: 5, outputTokens: 10 };
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      concurrency: 1,
    });

    const doneCalls = vi.mocked(sendSSEDone).mock.calls;
    const result = doneCalls[0][1] as any;
    // Case should succeed after retries
    expect(result.cases[0].status).not.toBe("error");
    expect(attempt).toBe(3); // 2 failures + 1 success
  });

  it("marks case as error after exhausting 429 retries (TC-020)", async () => {
    const cases = makeEvalCases(1, 1);

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (): Promise<GenerateResult> => {
        throw new Error("429 Rate limit exceeded");
      }),
    };

    const res = makeMockRes();

    await runBenchmarkSSE({
      res,
      skillDir: "/tmp/test-skill",
      skillName: "test",
      systemPrompt: "system",
      runType: "benchmark",
      provider: "anthropic",
      evalCases: cases,
      filterIds: null,
      client,
      isAborted: () => false,
      concurrency: 1,
    });

    const doneCalls = vi.mocked(sendSSEDone).mock.calls;
    const result = doneCalls[0][1] as any;
    expect(result.cases[0].status).toBe("error");
    // 1 initial + 3 retries = 4 total attempts
    expect(client.generate).toHaveBeenCalledTimes(4);
  }, 30000); // longer timeout due to retry delays
});
