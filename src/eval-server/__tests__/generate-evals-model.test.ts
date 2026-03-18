// ---------------------------------------------------------------------------
// RED/verification tests: generate-evals model forwarding (US-004 / 0563)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted pattern)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  withHeartbeat: vi.fn(),
  startDynamicHeartbeat: vi.fn(),
  resolveSkillDir: vi.fn(),
  loadAndValidateEvals: vi.fn(),
  createLlmClient: vi.fn(),
  buildEvalInitPrompt: vi.fn(),
  buildIntegrationEvalPrompt: vi.fn(),
  parseGeneratedEvals: vi.fn(),
  parseGeneratedIntegrationEvals: vi.fn(),
  detectMcpDependencies: vi.fn(),
  detectBrowserRequirements: vi.fn(),
  detectPlatformTargets: vi.fn(),
  detectSkillDependencies: vi.fn(),
  buildEvalSystemPrompt: vi.fn(),
  buildBaselineSystemPrompt: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  scanSkills: vi.fn(),
  classifyOrigin: vi.fn(),
  readBenchmark: vi.fn(),
  writeHistoryEntry: vi.fn(),
  listHistory: vi.fn(),
  readHistoryEntry: vi.fn(),
  computeRegressions: vi.fn(),
  deleteHistoryEntry: vi.fn(),
  getCaseHistory: vi.fn(),
  computeStats: vi.fn(),
  judgeAssertion: vi.fn(),
  runComparison: vi.fn(),
  computeVerdict: vi.fn(),
  generateActionItems: vi.fn(),
  testActivation: vi.fn(),
  writeActivationRun: vi.fn(),
  listActivationRuns: vi.fn(),
  getActivationRun: vi.fn(),
  runBenchmarkSSE: vi.fn(),
  runSingleCaseSSE: vi.fn(),
  assembleBulkResult: vi.fn(),
  getSkillSemaphore: vi.fn(),
  classifyError: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson, readBody: mocks.readBody };
});

vi.mock("../sse-helpers.js", () => ({
  initSSE: mocks.initSSE,
  sendSSE: mocks.sendSSE,
  sendSSEDone: mocks.sendSSEDone,
  withHeartbeat: mocks.withHeartbeat,
  startDynamicHeartbeat: mocks.startDynamicHeartbeat,
}));

vi.mock("../skill-resolver.js", () => ({ resolveSkillDir: mocks.resolveSkillDir }));

vi.mock("../error-classifier.js", () => ({ classifyError: mocks.classifyError }));

vi.mock("../benchmark-runner.js", () => ({
  runBenchmarkSSE: mocks.runBenchmarkSSE,
  runSingleCaseSSE: mocks.runSingleCaseSSE,
  assembleBulkResult: mocks.assembleBulkResult,
}));

vi.mock("../concurrency.js", () => ({
  getSkillSemaphore: mocks.getSkillSemaphore.mockReturnValue({
    acquire: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("../../eval/skill-scanner.js", () => ({
  scanSkills: mocks.scanSkills.mockReturnValue([]),
  classifyOrigin: mocks.classifyOrigin,
}));

vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: mocks.loadAndValidateEvals,
  EvalValidationError: class extends Error { errors: unknown[]; constructor(e: unknown[]) { super("validation"); this.errors = e; } },
}));

vi.mock("../../eval/benchmark.js", () => ({
  readBenchmark: mocks.readBenchmark,
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: mocks.writeHistoryEntry,
  listHistory: mocks.listHistory.mockReturnValue([]),
  readHistoryEntry: mocks.readHistoryEntry,
  computeRegressions: mocks.computeRegressions,
  deleteHistoryEntry: mocks.deleteHistoryEntry,
  getCaseHistory: mocks.getCaseHistory,
  computeStats: mocks.computeStats,
}));

vi.mock("../../eval/judge.js", () => ({ judgeAssertion: mocks.judgeAssertion }));

vi.mock("../../eval/prompt-builder.js", () => ({
  buildEvalSystemPrompt: mocks.buildEvalSystemPrompt,
  buildBaselineSystemPrompt: mocks.buildBaselineSystemPrompt,
  buildEvalInitPrompt: mocks.buildEvalInitPrompt,
  buildIntegrationEvalPrompt: mocks.buildIntegrationEvalPrompt,
  parseGeneratedEvals: mocks.parseGeneratedEvals,
  parseGeneratedIntegrationEvals: mocks.parseGeneratedIntegrationEvals,
  detectBrowserRequirements: mocks.detectBrowserRequirements,
  detectPlatformTargets: mocks.detectPlatformTargets,
}));

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: mocks.createLlmClient,
}));

vi.mock("../../eval/comparator.js", () => ({ runComparison: mocks.runComparison }));
vi.mock("../../eval/verdict.js", () => ({ computeVerdict: mocks.computeVerdict }));
vi.mock("../../eval/action-items.js", () => ({ generateActionItems: mocks.generateActionItems }));

vi.mock("../../eval/activation-tester.js", () => ({ testActivation: mocks.testActivation }));
vi.mock("../../eval/mcp-detector.js", () => ({
  detectMcpDependencies: mocks.detectMcpDependencies,
  detectSkillDependencies: mocks.detectSkillDependencies,
}));
vi.mock("../../eval/activation-history.js", () => ({
  writeActivationRun: mocks.writeActivationRun,
  listActivationRuns: mocks.listActivationRuns,
  getActivationRun: mocks.getActivationRun,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: mocks.existsSync,
    readFileSync: mocks.readFileSync,
    writeFileSync: mocks.writeFileSync,
    mkdirSync: mocks.mkdirSync,
    rmSync: mocks.rmSync,
    readdirSync: mocks.readdirSync,
    statSync: mocks.statSync,
  };
});

// ---------------------------------------------------------------------------
// Import and capture route handlers
// ---------------------------------------------------------------------------

const { registerRoutes } = await import("../api-routes.js");

function captureHandlers() {
  const handlers: Record<string, Record<string, Function>> = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter = {
    get: vi.fn((path: string, handler: Function) => { handlers.get[path] = handler; }),
    post: vi.fn((path: string, handler: Function) => { handlers.post[path] = handler; }),
    put: vi.fn((path: string, handler: Function) => { handlers.put[path] = handler; }),
    delete: vi.fn((path: string, handler: Function) => { handlers.delete[path] = handler; }),
  };
  registerRoutes(fakeRouter as any, "/root");
  return handlers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generate-evals model forwarding (US-004 / 0563)", () => {
  let handler: Function;
  const params = { plugin: "marketing", skill: "test-skill" };

  beforeEach(() => {
    vi.clearAllMocks();

    const handlers = captureHandlers();
    handler = handlers.post["/api/skills/:plugin/:skill/generate-evals"];

    mocks.resolveSkillDir.mockReturnValue("/fake/skill/dir");
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("---\nname: test-skill\n---\nSkill body");
    mocks.loadAndValidateEvals.mockReturnValue({ skill_name: "test-skill", evals: [] });
    mocks.buildEvalInitPrompt.mockReturnValue("unit test prompt");
    mocks.buildIntegrationEvalPrompt.mockReturnValue("integration test prompt");
    mocks.detectMcpDependencies.mockReturnValue([]);
    mocks.detectBrowserRequirements.mockReturnValue(null);
    mocks.detectPlatformTargets.mockReturnValue([]);
    mocks.parseGeneratedEvals.mockReturnValue([]);
    mocks.parseGeneratedIntegrationEvals.mockReturnValue([]);

    const mockClient = {
      generate: vi.fn().mockResolvedValue('```json\n{"evals": []}\n```'),
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    };
    mocks.createLlmClient.mockReturnValue(mockClient);
    // withHeartbeat just calls the fn directly
    mocks.withHeartbeat.mockImplementation((_res: unknown, _id: unknown, _phase: unknown, _msg: unknown, fn: () => unknown) => fn());
  });

  it("AC-US4-01/02: passes provider and model from request body to createLlmClient", async () => {
    expect(handler).toBeDefined();

    mocks.readBody.mockResolvedValue({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
    });

    const req = { url: "/api/skills/marketing/test-skill/generate-evals?sse", headers: { accept: "text/event-stream" }, on: vi.fn() } as any;
    const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), on: vi.fn(), setHeader: vi.fn() } as any;

    await handler(req, res, params);

    expect(mocks.createLlmClient).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-opus-4-20250514",
      })
    );
  });

  it("AC-US4-03: uses buildIntegrationEvalPrompt when testType is 'integration'", async () => {
    mocks.readBody.mockResolvedValue({ testType: "integration" });

    const req = { url: "/api/skills/marketing/test-skill/generate-evals?sse", headers: { accept: "text/event-stream" }, on: vi.fn() } as any;
    const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), on: vi.fn(), setHeader: vi.fn() } as any;

    await handler(req, res, params);

    expect(mocks.buildIntegrationEvalPrompt).toHaveBeenCalled();
    expect(mocks.buildEvalInitPrompt).not.toHaveBeenCalled();
  });

  it("AC-US4-04: empty body falls back to defaults without error", async () => {
    mocks.readBody.mockResolvedValue({});

    const req = { url: "/api/skills/marketing/test-skill/generate-evals?sse", headers: { accept: "text/event-stream" }, on: vi.fn() } as any;
    const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), on: vi.fn(), setHeader: vi.fn() } as any;

    await handler(req, res, params);

    expect(mocks.createLlmClient).toHaveBeenCalled();
    expect(mocks.buildEvalInitPrompt).toHaveBeenCalled();
  });
});
