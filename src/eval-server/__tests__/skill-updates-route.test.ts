// ---------------------------------------------------------------------------
// Unit tests for GET /api/skills/updates route
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson, readBody: vi.fn() };
});

vi.mock("node:child_process", () => ({
  execSync: mocks.execSync,
}));

// Stub everything else registerRoutes depends on
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(), existsSync: vi.fn(() => false), rmSync: vi.fn(), readdirSync: vi.fn(() => []), statSync: vi.fn() };
});
vi.mock("../sse-helpers.js", () => ({ initSSE: vi.fn(), sendSSE: vi.fn(), sendSSEDone: vi.fn(), withHeartbeat: vi.fn(), startDynamicHeartbeat: vi.fn() }));
vi.mock("../data-events.js", () => ({ dataEventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, emitDataEvent: vi.fn() }));
vi.mock("../error-classifier.js", () => ({ classifyError: vi.fn() }));
vi.mock("../benchmark-runner.js", () => ({ runBenchmarkSSE: vi.fn(), runSingleCaseSSE: vi.fn(), assembleBulkResult: vi.fn() }));
vi.mock("../concurrency.js", () => ({ getSkillSemaphore: vi.fn(() => ({ acquire: vi.fn(async () => () => {}) })) }));
vi.mock("../skill-resolver.js", () => ({ resolveSkillDir: vi.fn() }));
vi.mock("../../eval/skill-scanner.js", () => ({ scanSkills: vi.fn(async () => []), classifyOrigin: vi.fn() }));
vi.mock("../../eval/schema.js", () => ({ loadAndValidateEvals: vi.fn(), EvalValidationError: class extends Error {} }));
vi.mock("../../eval/benchmark.js", () => ({ readBenchmark: vi.fn(async () => null) }));
vi.mock("../../eval/benchmark-history.js", () => ({ writeHistoryEntry: vi.fn(), listHistory: vi.fn(), readHistoryEntry: vi.fn(), computeRegressions: vi.fn(), deleteHistoryEntry: vi.fn(), getCaseHistory: vi.fn(), computeStats: vi.fn() }));
vi.mock("../../eval/judge.js", () => ({ judgeAssertion: vi.fn() }));
vi.mock("../../eval/prompt-builder.js", () => ({ buildEvalSystemPrompt: vi.fn(), buildBaselineSystemPrompt: vi.fn(), buildEvalInitPrompt: vi.fn(), parseGeneratedEvals: vi.fn(), buildIntegrationEvalPrompt: vi.fn(), parseGeneratedIntegrationEvals: vi.fn(), detectBrowserRequirements: vi.fn(), detectPlatformTargets: vi.fn() }));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: vi.fn() }));
vi.mock("../../eval/comparator.js", () => ({ runComparison: vi.fn() }));
vi.mock("../../eval/verdict.js", () => ({ computeVerdict: vi.fn() }));
vi.mock("../../eval/action-items.js", () => ({ generateActionItems: vi.fn() }));
vi.mock("../../eval/activation-tester.js", () => ({ testActivation: vi.fn() }));
vi.mock("../../eval/mcp-detector.js", () => ({ detectMcpDependencies: vi.fn(), detectSkillDependencies: vi.fn() }));
vi.mock("../../eval/activation-history.js", () => ({ writeActivationRun: vi.fn(), listActivationRuns: vi.fn(), getActivationRun: vi.fn() }));

// ---------------------------------------------------------------------------
// Import and capture the handler
// ---------------------------------------------------------------------------

const { registerRoutes } = await import("../api-routes.js");

function captureHandler(): any {
  const handlers: Record<string, Record<string, any>> = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter = {
    get: vi.fn((path: string, handler: any) => { handlers.get[path] = handler; }),
    post: vi.fn((path: string, handler: any) => { handlers.post[path] = handler; }),
    put: vi.fn((path: string, handler: any) => { handlers.put[path] = handler; }),
    delete: vi.fn((path: string, handler: any) => { handlers.delete[path] = handler; }),
  };
  registerRoutes(fakeRouter as any, "/root");
  return handlers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/skills/updates", () => {
  let handler: any;
  const fakeReq = {} as any;
  const fakeRes = {} as any;

  beforeEach(() => {
    vi.resetAllMocks();
    const handlers = captureHandler();
    handler = handlers.get["/api/skills/updates"];
  });

  it("is registered as a route", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("is registered BEFORE /:plugin/:skill routes", () => {
    const callOrder: string[] = [];
    const orderRouter = {
      get: vi.fn((path: string) => { callOrder.push(path); }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    registerRoutes(orderRouter as any, "/root");

    const updatesIdx = callOrder.indexOf("/api/skills/updates");
    const paramIdx = callOrder.indexOf("/api/skills/:plugin/:skill");
    expect(updatesIdx).toBeGreaterThan(-1);
    expect(paramIdx).toBeGreaterThan(-1);
    expect(updatesIdx).toBeLessThan(paramIdx);
  });

  it("returns parsed JSON from vskill outdated --json", async () => {
    const outdatedResult = [
      { name: "owner/repo/skill", installed: "1.0.0", latest: "1.0.3", updateAvailable: true },
      { name: "owner/repo/other", installed: "1.0.2", latest: "1.0.2", updateAvailable: false },
    ];
    mocks.execSync.mockReturnValue(Buffer.from(JSON.stringify(outdatedResult)));

    await handler(fakeReq, fakeRes);

    expect(mocks.execSync).toHaveBeenCalledWith("vskill outdated --json", expect.objectContaining({ timeout: expect.any(Number) }));
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, outdatedResult, 200, fakeReq);
  });

  it("returns empty array when vskill outdated exits non-zero", async () => {
    mocks.execSync.mockImplementation(() => { throw new Error("exit code 1"); });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, [], 200, fakeReq);
  });

  it("returns empty array when JSON parsing fails", async () => {
    mocks.execSync.mockReturnValue(Buffer.from("not valid json"));

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, [], 200, fakeReq);
  });
});
