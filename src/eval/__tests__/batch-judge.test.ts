import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Assertion } from "../schema.js";
import type { LlmClient } from "../llm.js";

// ---------------------------------------------------------------------------
// Mock the @anthropic-ai/sdk module before importing batch-judge
// ---------------------------------------------------------------------------

const mockBatchCreate = vi.fn();
const mockBatchRetrieve = vi.fn();
const mockBatchCancel = vi.fn();
const mockBatchResults = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      batches: {
        create: mockBatchCreate,
        retrieve: mockBatchRetrieve,
        cancel: mockBatchCancel,
        results: mockBatchResults,
      },
    };
  },
}));

import {
  batchJudgeAssertions,
  getPollInterval,
  calculateBatchCost,
} from "../batch-judge.js";
import type { BatchJudgeRequest, BatchCostInfo } from "../batch-judge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClient(response?: string): LlmClient {
  return {
    generate: vi.fn().mockResolvedValue({
      text: response || '{"pass": true, "reasoning": "ok"}',
      durationMs: 100,
      inputTokens: null,
      outputTokens: null,
      cost: null,
    }),
    model: "test-model",
  };
}

function makeAssertion(id: string, text: string): Assertion {
  return { id, text, type: "boolean" };
}

function makeRequests(count: number): BatchJudgeRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    evalId: `eval${Math.floor(i / 2) + 1}`,
    assertionIdx: i % 2,
    assertion: makeAssertion(`assert-${i}`, `Assertion ${i}`),
    output: `LLM output for assertion ${i}`,
  }));
}

function makeBatchResultEntry(customId: string, pass: boolean, reasoning: string) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        content: [
          { type: "text", text: JSON.stringify({ pass, reasoning }) },
        ],
      },
    },
  };
}

// Async iterable helper for mockBatchResults
function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let idx = 0;
      return {
        async next() {
          if (idx < items.length) {
            return { value: items[idx++], done: false };
          }
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}

const BASE_OPTIONS = { apiKey: "sk-test-key", model: "claude-sonnet-4-6" };

/** Run an async fn while advancing fake timers until it resolves */
async function runWithTimers<T>(fn: () => Promise<T>): Promise<T> {
  const promise = fn();
  // Advance timers in small steps until the promise resolves
  let resolved = false;
  let result: T;
  promise.then((r) => { result = r; resolved = true; });
  while (!resolved) {
    await vi.advanceTimersByTimeAsync(5_100);
  }
  return result!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getPollInterval", () => {
  it("returns 5s for first 60 seconds", () => {
    expect(getPollInterval(0)).toBe(5_000);
    expect(getPollInterval(30_000)).toBe(5_000);
    expect(getPollInterval(59_999)).toBe(5_000);
  });

  it("returns 15s between 60s and 5 minutes", () => {
    expect(getPollInterval(60_000)).toBe(15_000);
    expect(getPollInterval(120_000)).toBe(15_000);
    expect(getPollInterval(299_999)).toBe(15_000);
  });

  it("returns 30s after 5 minutes", () => {
    expect(getPollInterval(300_000)).toBe(30_000);
    expect(getPollInterval(500_000)).toBe(30_000);
  });
});

describe("calculateBatchCost", () => {
  it("calculates 50% discount for sonnet model", () => {
    const result = calculateBatchCost(1_000_000, 100_000, "claude-sonnet-4-6");
    // Sequential: (1M/1M)*3.0 + (100K/1M)*15.0 = 3.0 + 1.5 = 4.5
    expect(result.sequentialCost).toBeCloseTo(4.5, 2);
    expect(result.batchCost).toBeCloseTo(2.25, 2);
    expect(result.savings).toBeCloseTo(2.25, 2);
  });

  it("calculates for haiku model", () => {
    const result = calculateBatchCost(1_000_000, 100_000, "claude-haiku-4-5-20251001");
    // Sequential: (1M/1M)*0.80 + (100K/1M)*4.0 = 0.80 + 0.40 = 1.20
    expect(result.sequentialCost).toBeCloseTo(1.2, 2);
    expect(result.batchCost).toBeCloseTo(0.6, 2);
  });

  it("defaults to sonnet pricing for unknown models", () => {
    const result = calculateBatchCost(1_000_000, 100_000, "unknown-model");
    expect(result.sequentialCost).toBeCloseTo(4.5, 2);
  });
});

describe("batchJudgeAssertions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to sequential for small batches (below minBatchSize)", async () => {
    const requests = makeRequests(3); // below default min of 5
    const client = mockClient();
    const judgeClient = mockClient('{"pass": true, "reasoning": "sequential"}');

    const { results, costInfo } = await batchJudgeAssertions(
      requests, client, judgeClient,
      { ...BASE_OPTIONS, minBatchSize: 5 },
    );

    expect(results).toHaveLength(3);
    expect(mockBatchCreate).not.toHaveBeenCalled();
    expect(costInfo).toBeNull();
    expect(judgeClient.generate).toHaveBeenCalledTimes(3);
  });

  it("submits batch with correct custom_id format and max_tokens", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient();

    mockBatchCreate.mockResolvedValue({
      id: "batch-123",
      request_counts: { succeeded: 6 },
    });
    mockBatchRetrieve.mockResolvedValue({ processing_status: "ended" });
    mockBatchResults.mockReturnValue(
      asyncIterable(
        requests.map((r) =>
          makeBatchResultEntry(
            `${r.evalId}_${r.assertionIdx}`,
            true,
            "ok",
          ),
        ),
      ),
    );

    await runWithTimers(() => batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS));

    expect(mockBatchCreate).toHaveBeenCalledOnce();
    const createCall = mockBatchCreate.mock.calls[0][0];
    expect(createCall.requests).toHaveLength(6);

    // Verify custom_id format
    expect(createCall.requests[0].custom_id).toBe("eval1_0");
    expect(createCall.requests[1].custom_id).toBe("eval1_1");
    expect(createCall.requests[2].custom_id).toBe("eval2_0");

    // Verify max_tokens
    for (const req of createCall.requests) {
      expect(req.params.max_tokens).toBe(256);
    }
  });

  it("maps batch results back to correct AssertionResult[]", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient();

    mockBatchCreate.mockResolvedValue({
      id: "batch-123",
      request_counts: { succeeded: 6 },
    });
    mockBatchRetrieve.mockResolvedValue({ processing_status: "ended" });

    const batchEntries = [
      makeBatchResultEntry("eval1_0", true, "assertion 0 passed"),
      makeBatchResultEntry("eval1_1", false, "assertion 1 failed"),
      makeBatchResultEntry("eval2_0", true, "assertion 2 passed"),
      makeBatchResultEntry("eval2_1", true, "assertion 3 passed"),
      makeBatchResultEntry("eval3_0", false, "assertion 4 failed"),
      makeBatchResultEntry("eval3_1", true, "assertion 5 passed"),
    ];
    mockBatchResults.mockReturnValue(asyncIterable(batchEntries));

    const { results } = await runWithTimers(() =>
      batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS),
    );

    expect(results).toHaveLength(6);
    expect(results[0]).toMatchObject({ id: "assert-0", pass: true, reasoning: "assertion 0 passed" });
    expect(results[1]).toMatchObject({ id: "assert-1", pass: false, reasoning: "assertion 1 failed" });
    expect(results[4]).toMatchObject({ id: "assert-4", pass: false, reasoning: "assertion 4 failed" });
  });

  it("falls back to sequential when batch submission fails", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient('{"pass": true, "reasoning": "fallback"}');

    mockBatchCreate.mockRejectedValue(new Error("API connection refused"));

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { results, costInfo } = await batchJudgeAssertions(
      requests, client, judgeClient, BASE_OPTIONS,
    );

    expect(results).toHaveLength(6);
    expect(costInfo).toBeNull();
    expect(judgeClient.generate).toHaveBeenCalledTimes(6);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("API connection refused"),
    );

    consoleSpy.mockRestore();
  });

  it("handles errored batch items gracefully", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient();

    mockBatchCreate.mockResolvedValue({
      id: "batch-123",
      request_counts: { succeeded: 4 },
    });
    mockBatchRetrieve.mockResolvedValue({ processing_status: "ended" });

    const entries = [
      makeBatchResultEntry("eval1_0", true, "ok"),
      {
        custom_id: "eval1_1",
        result: { type: "errored", error: { message: "token limit exceeded" } },
      },
      makeBatchResultEntry("eval2_0", true, "ok"),
      makeBatchResultEntry("eval2_1", true, "ok"),
      makeBatchResultEntry("eval3_0", false, "nope"),
      {
        custom_id: "eval3_1",
        result: { type: "canceled" },
      },
    ];
    mockBatchResults.mockReturnValue(asyncIterable(entries));

    const { results } = await runWithTimers(() =>
      batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS),
    );

    expect(results).toHaveLength(6);
    expect(results[0].pass).toBe(true);
    expect(results[1].pass).toBe(false);
    expect(results[1].reasoning).toContain("errored");
    expect(results[5].pass).toBe(false);
    expect(results[5].reasoning).toContain("canceled");
  });

  it("returns cost info with 50% discount for successful batch", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient();

    mockBatchCreate.mockResolvedValue({
      id: "batch-123",
      request_counts: { succeeded: 6 },
    });
    mockBatchRetrieve.mockResolvedValue({ processing_status: "ended" });
    mockBatchResults.mockReturnValue(
      asyncIterable(
        requests.map((r) =>
          makeBatchResultEntry(`${r.evalId}_${r.assertionIdx}`, true, "ok"),
        ),
      ),
    );

    const { costInfo } = await runWithTimers(() =>
      batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS),
    );

    expect(costInfo).not.toBeNull();
    expect(costInfo!.batchCost).toBe(costInfo!.sequentialCost * 0.5);
    expect(costInfo!.savings).toBeGreaterThan(0);
  });
});

describe("batchJudgeAssertions — polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls with escalating intervals until batch completes", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient();

    mockBatchCreate.mockResolvedValue({
      id: "batch-poll-test",
      request_counts: { succeeded: 6 },
    });

    // First call: in_progress, second call: ended
    let pollCount = 0;
    mockBatchRetrieve.mockImplementation(async () => {
      pollCount++;
      if (pollCount < 3) return { processing_status: "in_progress" };
      return { processing_status: "ended" };
    });

    mockBatchResults.mockReturnValue(
      asyncIterable(
        requests.map((r) =>
          makeBatchResultEntry(`${r.evalId}_${r.assertionIdx}`, true, "ok"),
        ),
      ),
    );

    const promise = batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS);

    // Advance past the polling intervals — the polling backoff escalates,
    // so we advance enough fake time to cover 3 polls plus headroom.
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }

    const { results } = await promise;

    expect(results).toHaveLength(6);
    expect(mockBatchRetrieve).toHaveBeenCalledWith("batch-poll-test");
    expect(pollCount).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("times out and falls back after 10 minutes", async () => {
    const requests = makeRequests(6);
    const client = mockClient();
    const judgeClient = mockClient('{"pass": true, "reasoning": "timeout fallback"}');

    mockBatchCreate.mockResolvedValue({ id: "batch-timeout" });

    // Always return in_progress — never completes
    mockBatchRetrieve.mockResolvedValue({ processing_status: "in_progress" });
    mockBatchCancel.mockResolvedValue({});

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const promise = batchJudgeAssertions(requests, client, judgeClient, BASE_OPTIONS);

    // Advance past 10 minutes
    for (let i = 0; i < 200; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }

    const { results, costInfo } = await promise;

    // Should have fallen back to sequential after timeout
    expect(results).toHaveLength(6);
    expect(costInfo).toBeNull();
    expect(judgeClient.generate).toHaveBeenCalledTimes(6);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("timed out"),
    );

    consoleSpy.mockRestore();
  });
});
