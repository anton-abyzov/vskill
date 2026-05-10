// ---------------------------------------------------------------------------
// Tests: comparison endpoint emits assertion_result + case_complete SSE events
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvalCase } from "../../eval/schema.js";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  rmSync: vi.fn(),
}));

vi.mock("../sse-helpers.js", () => ({
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  withHeartbeat: vi.fn((_res: unknown, _id: unknown, _phase: unknown, _msg: unknown, fn: () => unknown) => fn()),
  startDynamicHeartbeat: vi.fn(() => ({
    update: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("../../eval/judge.js", () => ({
  judgeAssertion: vi.fn(),
}));

vi.mock("../../eval/comparator.js", () => ({
  runComparison: vi.fn(),
}));

vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(),
  EvalValidationError: class extends Error {},
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn().mockResolvedValue("some-file.json"),
  listHistory: vi.fn().mockResolvedValue([]),
  readHistoryEntry: vi.fn().mockResolvedValue(null),
  computeRegressions: vi.fn().mockReturnValue([]),
  deleteHistoryEntry: vi.fn().mockResolvedValue(undefined),
  getCaseHistory: vi.fn().mockResolvedValue([]),
  computeStats: vi.fn().mockReturnValue(null),
}));

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: vi.fn(() => ({
    model: "test-model",
    generate: vi.fn(),
  })),
}));

vi.mock("../../eval/verdict.js", () => ({
  computeVerdict: vi.fn(() => ({ verdict: "pass", summary: "" })),
}));

vi.mock("../../eval/action-items.js", () => ({
  generateActionItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../eval/skill-scanner.js", () => ({
  scanSkills: vi.fn().mockResolvedValue([]),
  classifyOrigin: vi.fn(() => "local"),
}));

vi.mock("../../eval/benchmark.js", () => ({
  readBenchmark: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../eval/prompt-builder.js", () => ({
  buildEvalSystemPrompt: vi.fn(() => "system"),
  buildBaselineSystemPrompt: vi.fn(() => "baseline"),
  buildEvalInitPrompt: vi.fn(() => "init"),
  parseGeneratedEvals: vi.fn(() => []),
}));

vi.mock("../../eval/activation-tester.js", () => ({
  testActivation: vi.fn(),
}));

vi.mock("../concurrency.js", () => ({
  getSkillSemaphore: vi.fn(() => ({
    runExclusive: vi.fn((fn: () => unknown) => fn()),
  })),
}));

vi.mock("../skill-resolver.js", () => ({
  resolveSkillDir: vi.fn((_root: string, plugin: string, skill: string) => `/skills/${plugin}/${skill}`),
}));

vi.mock("../error-classifier.js", () => ({
  classifyError: vi.fn(() => "unknown"),
}));

vi.mock("../benchmark-runner.js", () => ({
  runBenchmarkSSE: vi.fn(),
  runSingleCaseSSE: vi.fn(),
  assembleBulkResult: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { Router } from "../router.js";
import { registerRoutes } from "../api-routes.js";
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";
import { sendSSE } from "../sse-helpers.js";
import { judgeAssertion } from "../../eval/judge.js";
import { runComparison } from "../../eval/comparator.js";
import { loadAndValidateEvals } from "../../eval/schema.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 1,
    name: "test eval",
    prompt: "do something",
    expected_output: "expected",
    files: [],
    assertions: [
      { id: "a1", text: "output is correct", type: "boolean" },
    ],
    ...overrides,
  };
}

function makeComparisonResult() {
  return {
    prompt: "do something",
    skillOutput: "skill output",
    baselineOutput: "baseline output",
    skillDurationMs: 100,
    skillTokens: 50,
    baselineDurationMs: 80,
    baselineTokens: 40,
    skillContentScore: 85,
    skillStructureScore: 80,
    baselineContentScore: 70,
    baselineStructureScore: 75,
    winner: "skill" as const,
  };
}

function makeRouter() {
  const router = new Router();
  registerRoutes(router, "/test-root");
  return router;
}

function makeMockReq(method: string, url: string, body?: unknown) {
  const listeners: Record<string, Array<(data?: unknown) => void>> = {};
  return {
    method,
    url,
    // 0836 US-002: pass the X-Studio-Token through the gate.
    headers: { host: "localhost", ...studioTokenHeaders() },
    on: vi.fn((event: string, cb: (data?: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      // Simulate end event asynchronously for body parsing
      if (event === "end") {
        setTimeout(() => cb(), 0);
      }
      if (event === "data" && body) {
        setTimeout(() => cb(Buffer.from(JSON.stringify(body))), 0);
      }
    }),
    _listeners: listeners,
  } as unknown as import("http").IncomingMessage;
}

function makeMockRes() {
  const closeListeners: Array<() => void> = [];
  return {
    headersSent: false,
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "close") closeListeners.push(cb);
    }),
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    _closeListeners: closeListeners,
  } as unknown as import("http").ServerResponse;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("comparison endpoint SSE events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits assertion_result event per assertion during comparison run", async () => {
    const evalCase = makeEvalCase();

    vi.mocked(loadAndValidateEvals).mockReturnValue({
      skill_name: "my-skill",
      evals: [evalCase],
    } as ReturnType<typeof loadAndValidateEvals>);

    vi.mocked(runComparison).mockResolvedValue(makeComparisonResult());

    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1",
      text: "output is correct",
      pass: true,
      reasoning: "looks good",
    });

    const router = makeRouter();
    const req = makeMockReq("POST", "/api/skills/test/my-skill/compare");
    const res = makeMockRes();

    await router.handle(req, res);

    const sseCalls = vi.mocked(sendSSE).mock.calls;
    const assertionResultEvents = sseCalls.filter(([, event]) => event === "assertion_result");

    expect(assertionResultEvents).toHaveLength(1);
    const [, , data] = assertionResultEvents[0] as [unknown, string, Record<string, unknown>];
    expect(data.eval_id).toBe(1);
    expect(data.assertion_id).toBe("a1");
    expect(data.text).toBe("output is correct");
    expect(data.pass).toBe(true);
    expect(data.reasoning).toBe("looks good");
  });

  it("emits case_complete event after processing all assertions", async () => {
    const evalCase = makeEvalCase({
      assertions: [
        { id: "a1", text: "check one", type: "boolean" },
        { id: "a2", text: "check two", type: "boolean" },
      ],
    });

    vi.mocked(loadAndValidateEvals).mockReturnValue({
      skill_name: "my-skill",
      evals: [evalCase],
    } as ReturnType<typeof loadAndValidateEvals>);

    vi.mocked(runComparison).mockResolvedValue(makeComparisonResult());

    // Each assertion now calls judgeAssertion twice (skill + baseline via Promise.all)
    vi.mocked(judgeAssertion)
      .mockResolvedValueOnce({ id: "a1", text: "check one", pass: true, reasoning: "ok" })
      .mockResolvedValueOnce({ id: "a1", text: "check one", pass: true, reasoning: "baseline ok" })
      .mockResolvedValueOnce({ id: "a2", text: "check two", pass: true, reasoning: "ok" })
      .mockResolvedValueOnce({ id: "a2", text: "check two", pass: true, reasoning: "baseline ok" });

    const router = makeRouter();
    const req = makeMockReq("POST", "/api/skills/test/my-skill/compare");
    const res = makeMockRes();

    await router.handle(req, res);

    const sseCalls = vi.mocked(sendSSE).mock.calls;
    const caseCompleteEvents = sseCalls.filter(([, event]) => event === "case_complete");

    expect(caseCompleteEvents).toHaveLength(1);
    const [, , data] = caseCompleteEvents[0] as [unknown, string, Record<string, unknown>];
    expect(data.eval_id).toBe(1);
    expect(data.status).toBe("pass");
    expect(data.pass_rate).toBe(1.0);
  });

  it("emits case_complete with status=fail when some assertions fail", async () => {
    const evalCase = makeEvalCase({
      assertions: [
        { id: "a1", text: "check one", type: "boolean" },
        { id: "a2", text: "check two", type: "boolean" },
      ],
    });

    vi.mocked(loadAndValidateEvals).mockReturnValue({
      skill_name: "my-skill",
      evals: [evalCase],
    } as ReturnType<typeof loadAndValidateEvals>);

    vi.mocked(runComparison).mockResolvedValue(makeComparisonResult());

    // Each assertion now calls judgeAssertion twice (skill + baseline via Promise.all)
    // a1: skill=pass, baseline=pass; a2: skill=fail, baseline=pass
    vi.mocked(judgeAssertion)
      .mockResolvedValueOnce({ id: "a1", text: "check one", pass: true, reasoning: "ok" })
      .mockResolvedValueOnce({ id: "a1", text: "check one", pass: true, reasoning: "baseline ok" })
      .mockResolvedValueOnce({ id: "a2", text: "check two", pass: false, reasoning: "nope" })
      .mockResolvedValueOnce({ id: "a2", text: "check two", pass: true, reasoning: "baseline ok" });

    const router = makeRouter();
    const req = makeMockReq("POST", "/api/skills/test/my-skill/compare");
    const res = makeMockRes();

    await router.handle(req, res);

    const sseCalls = vi.mocked(sendSSE).mock.calls;
    const caseCompleteEvents = sseCalls.filter(([, event]) => event === "case_complete");

    expect(caseCompleteEvents).toHaveLength(1);
    const [, , data] = caseCompleteEvents[0] as [unknown, string, Record<string, unknown>];
    expect(data.status).toBe("fail");
    expect(data.pass_rate).toBe(0.5);

    // Verify baseline_assertion_result SSE events are emitted
    const baselineEvents = sseCalls.filter(([, event]) => event === "baseline_assertion_result");
    expect(baselineEvents).toHaveLength(2);
  });

  it("still emits legacy outputs_ready and comparison_scored events (backward compat)", async () => {
    const evalCase = makeEvalCase();

    vi.mocked(loadAndValidateEvals).mockReturnValue({
      skill_name: "my-skill",
      evals: [evalCase],
    } as ReturnType<typeof loadAndValidateEvals>);

    vi.mocked(runComparison).mockResolvedValue(makeComparisonResult());
    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "a1", text: "output is correct", pass: true, reasoning: "ok",
    });

    const router = makeRouter();
    const req = makeMockReq("POST", "/api/skills/test/my-skill/compare");
    const res = makeMockRes();

    await router.handle(req, res);

    const sseEvents = vi.mocked(sendSSE).mock.calls.map(([, event]) => event);
    expect(sseEvents).toContain("outputs_ready");
    expect(sseEvents).toContain("comparison_scored");
  });
});
