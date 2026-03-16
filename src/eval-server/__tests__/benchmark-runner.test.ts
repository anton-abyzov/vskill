// ---------------------------------------------------------------------------
// Integration tests for benchmark-runner.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BenchmarkCase } from "../../eval/benchmark.js";
import type { EvalCase } from "../../eval/schema.js";
import type { LlmClient } from "../../eval/llm.js";

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

import { assembleBulkResult, runSingleCaseSSE } from "../benchmark-runner.js";
import { judgeAssertion } from "../../eval/judge.js";
import { sendSSE } from "../sse-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return {
    eval_id: 1,
    eval_name: "test-case",
    status: "pass",
    error_message: null,
    pass_rate: 1,
    durationMs: 100,
    tokens: 50,
    inputTokens: 20,
    outputTokens: 30,
    output: "some output",
    assertions: [
      { id: "a1", text: "checks something", pass: true, reasoning: "ok" },
    ],
    ...overrides,
  };
}

function makeEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 1,
    name: "test eval",
    prompt: "do something",
    expected_output: "something done",
    files: [],
    assertions: [
      { id: "a1", text: "output is correct", type: "boolean" },
    ],
    ...overrides,
  };
}

function makeMockClient(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    model: "test-model",
    generate: vi.fn().mockResolvedValue({
      text: "generated output",
      durationMs: 150,
      inputTokens: 10,
      outputTokens: 20,
    }),
    ...overrides,
  };
}

function makeMockRes() {
  return { write: vi.fn() } as any;
}

// ---------------------------------------------------------------------------
// assembleBulkResult
// ---------------------------------------------------------------------------

describe("assembleBulkResult", () => {
  const defaultMeta = {
    model: "claude-sonnet",
    skillName: "my-skill",
    runType: "benchmark" as const,
    provider: "anthropic",
  };

  it("computes overall_pass_rate correctly from cases", () => {
    const cases: BenchmarkCase[] = [
      makeCase({
        assertions: [
          { id: "a1", text: "x", pass: true, reasoning: "" },
          { id: "a2", text: "y", pass: false, reasoning: "" },
        ],
      }),
      makeCase({
        eval_id: 2,
        assertions: [
          { id: "a3", text: "z", pass: true, reasoning: "" },
          { id: "a4", text: "w", pass: true, reasoning: "" },
        ],
      }),
    ];

    const result = assembleBulkResult(cases, defaultMeta);
    // 3 passed out of 4 total
    expect(result.overall_pass_rate).toBe(0.75);
  });

  it("sets type from meta.runType", () => {
    const result = assembleBulkResult(
      [makeCase()],
      { ...defaultMeta, runType: "baseline" },
    );
    expect(result.type).toBe("baseline");
  });

  it("computes totalDurationMs from cases", () => {
    const cases = [
      makeCase({ durationMs: 200 }),
      makeCase({ eval_id: 2, durationMs: 350 }),
    ];
    const result = assembleBulkResult(cases, defaultMeta);
    expect(result.totalDurationMs).toBe(550);
  });

  it("computes totalInputTokens and totalOutputTokens when present", () => {
    const cases = [
      makeCase({ inputTokens: 10, outputTokens: 20 }),
      makeCase({ eval_id: 2, inputTokens: 30, outputTokens: 40 }),
    ];
    const result = assembleBulkResult(cases, defaultMeta);
    expect(result.totalInputTokens).toBe(40);
    expect(result.totalOutputTokens).toBe(60);
  });

  it("sets totalInputTokens/totalOutputTokens to null when no cases have them", () => {
    const cases = [
      makeCase({ inputTokens: undefined, outputTokens: undefined }),
    ];
    const result = assembleBulkResult(cases, defaultMeta);
    expect(result.totalInputTokens).toBeNull();
    expect(result.totalOutputTokens).toBeNull();
  });

  it("returns 0 overall_pass_rate when there are no assertions", () => {
    const cases = [makeCase({ assertions: [] })];
    const result = assembleBulkResult(cases, defaultMeta);
    expect(result.overall_pass_rate).toBe(0);
  });

  it("sets scope to bulk", () => {
    const result = assembleBulkResult([makeCase()], defaultMeta);
    expect(result.scope).toBe("bulk");
  });

  it("preserves model, skill_name, and provider from meta", () => {
    const result = assembleBulkResult([makeCase()], defaultMeta);
    expect(result.model).toBe("claude-sonnet");
    expect(result.skill_name).toBe("my-skill");
    expect(result.provider).toBe("anthropic");
  });
});

// ---------------------------------------------------------------------------
// runSingleCaseSSE
// ---------------------------------------------------------------------------

describe("runSingleCaseSSE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits case_start, output_ready, assertion_result, case_complete SSE events", async () => {
    const res = makeMockRes();
    const client = makeMockClient();
    const evalCase = makeEvalCase();

    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1",
      text: "output is correct",
      pass: true,
      reasoning: "looks good",
    });

    await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "you are a helper",
      client,
      isAborted: () => false,
    });

    const sseEvents = vi.mocked(sendSSE).mock.calls.map((c) => c[1]);
    expect(sseEvents).toContain("case_start");
    expect(sseEvents).toContain("output_ready");
    expect(sseEvents).toContain("assertion_result");
    expect(sseEvents).toContain("case_complete");
  });

  it("maps inputTokens and outputTokens from LLM result to BenchmarkCase", async () => {
    const res = makeMockRes();
    const client = makeMockClient({
      model: "test-model",
      generate: vi.fn().mockResolvedValue({
        text: "output text",
        durationMs: 200,
        inputTokens: 42,
        outputTokens: 58,
      }),
    });
    const evalCase = makeEvalCase();

    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1",
      text: "output is correct",
      pass: true,
      reasoning: "ok",
    });

    const result = await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "system",
      client,
      isAborted: () => false,
    });

    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(58);
    expect(result.tokens).toBe(100); // 42 + 58
  });

  it("handles LLM error gracefully (returns error status case)", async () => {
    const res = makeMockRes();
    const client = makeMockClient({
      model: "test-model",
      generate: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    });
    const evalCase = makeEvalCase();

    const result = await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "system",
      client,
      isAborted: () => false,
    });

    expect(result.status).toBe("error");
    expect(result.error_message).toBe("LLM timeout");
    expect(result.pass_rate).toBe(0);
    expect(result.assertions).toEqual([]);
  });

  it("sets status to fail when an assertion fails", async () => {
    const res = makeMockRes();
    const client = makeMockClient();
    const evalCase = makeEvalCase({
      assertions: [
        { id: "a1", text: "first check", type: "boolean" },
        { id: "a2", text: "second check", type: "boolean" },
      ],
    });

    vi.mocked(judgeAssertion)
      .mockResolvedValueOnce({ id: "a1", text: "first check", pass: true, reasoning: "ok" })
      .mockResolvedValueOnce({ id: "a2", text: "second check", pass: false, reasoning: "nope" });

    const result = await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "system",
      client,
      isAborted: () => false,
    });

    expect(result.status).toBe("fail");
    expect(result.pass_rate).toBe(0.5);
    expect(result.assertions).toHaveLength(2);
  });

  it("marks assertions as aborted when isAborted returns true", async () => {
    const res = makeMockRes();
    const client = makeMockClient();
    const evalCase = makeEvalCase({
      assertions: [
        { id: "a1", text: "first", type: "boolean" },
        { id: "a2", text: "second", type: "boolean" },
      ],
    });

    // Always aborted — assertions run via Promise.all, so aborted ones
    // get { pass: false, reasoning: "aborted" } immediately
    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1",
      text: "first",
      pass: true,
      reasoning: "ok",
    });

    const result = await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "system",
      client,
      isAborted: () => true,
    });

    // Both assertions should be present but marked as aborted
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions.every((a) => a.reasoning === "aborted")).toBe(true);
  });

  it("passes totalCases through to case_start event", async () => {
    const res = makeMockRes();
    const client = makeMockClient();
    const evalCase = makeEvalCase();

    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1",
      text: "output is correct",
      pass: true,
      reasoning: "ok",
    });

    await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt: "system",
      client,
      isAborted: () => false,
      totalCases: 5,
    });

    const caseStartCall = vi.mocked(sendSSE).mock.calls.find((c) => c[1] === "case_start");
    expect(caseStartCall).toBeDefined();
    expect((caseStartCall![2] as any).total).toBe(5);
  });
});
