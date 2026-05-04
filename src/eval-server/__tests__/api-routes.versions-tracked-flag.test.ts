// 0823 T-005/T-006 — /versions envelope includes provider + trackedForUpdates.
//
// trackedForUpdates is `true` only when the origin resolver claims the skill
// has an upstream AND the upstream returned at least one version. Otherwise
// `false` (and the UI hides CheckNowButton, swaps the "no upstream" message).

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  readLockfile: vi.fn(),
  parseSource: vi.fn(),
  resolveSkillApiNameImpl: vi.fn(),
  resolveSkillOrigin: vi.fn(),
  emitDataEvent: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson, readBody: mocks.readBody };
});
vi.mock("../sse-helpers.js", () => ({
  initSSE: mocks.initSSE,
  sendSSE: mocks.sendSSE,
  sendSSEDone: mocks.sendSSEDone,
  withHeartbeat: vi.fn(),
  startDynamicHeartbeat: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: mocks.readLockfile,
  writeLockfile: vi.fn(),
}));
vi.mock("../../resolvers/source-resolver.js", () => ({
  parseSource: mocks.parseSource,
}));
vi.mock("../skill-name-resolver.js", () => ({
  resolveSkillApiName: mocks.resolveSkillApiNameImpl,
  resetResolverCache: vi.fn(),
}));
vi.mock("../origin-resolver.js", () => ({
  resolveSkillOrigin: mocks.resolveSkillOrigin,
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
  };
});
vi.mock("../data-events.js", () => ({
  dataEventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  emitDataEvent: mocks.emitDataEvent,
}));
vi.mock("../error-classifier.js", () => ({ classifyError: vi.fn() }));
vi.mock("../benchmark-runner.js", () => ({
  runBenchmarkSSE: vi.fn(),
  runSingleCaseSSE: vi.fn(),
  assembleBulkResult: vi.fn(),
}));
vi.mock("../concurrency.js", () => ({
  getSkillSemaphore: vi.fn(() => ({ acquire: vi.fn(async () => () => {}) })),
}));
vi.mock("../skill-resolver.js", () => ({
  resolveSkillDir: vi.fn(),
  resolveAllowedSkillDir: vi.fn(),
}));
vi.mock("../../eval/skill-scanner.js", () => ({
  scanSkills: vi.fn(async () => []),
  classifyOrigin: vi.fn(),
}));
vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(),
  EvalValidationError: class extends Error {},
}));
vi.mock("../../eval/benchmark.js", () => ({ readBenchmark: vi.fn(async () => null) }));
vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(),
  listHistory: vi.fn(),
  readHistoryEntry: vi.fn(),
  computeRegressions: vi.fn(),
  deleteHistoryEntry: vi.fn(),
  getCaseHistory: vi.fn(),
  computeStats: vi.fn(),
}));
vi.mock("../../eval/judge.js", () => ({ judgeAssertion: vi.fn() }));
vi.mock("../../eval/prompt-builder.js", () => ({
  buildEvalSystemPrompt: vi.fn(),
  buildBaselineSystemPrompt: vi.fn(),
  buildEvalInitPrompt: vi.fn(),
  parseGeneratedEvals: vi.fn(),
  buildIntegrationEvalPrompt: vi.fn(),
  parseGeneratedIntegrationEvals: vi.fn(),
  detectBrowserRequirements: vi.fn(),
  detectPlatformTargets: vi.fn(),
}));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: vi.fn() }));
vi.mock("../../eval/comparator.js", () => ({ runComparison: vi.fn() }));
vi.mock("../../eval/verdict.js", () => ({ computeVerdict: vi.fn() }));
vi.mock("../../eval/action-items.js", () => ({ generateActionItems: vi.fn() }));
vi.mock("../../eval/activation-tester.js", () => ({ testActivation: vi.fn() }));
vi.mock("../../eval/mcp-detector.js", () => ({
  detectMcpDependencies: vi.fn(),
  detectSkillDependencies: vi.fn(),
}));
vi.mock("../../eval/activation-history.js", () => ({
  writeActivationRun: vi.fn(),
  listActivationRuns: vi.fn(),
  getActivationRun: vi.fn(),
}));
vi.mock("../../agents/agents-registry.js", () => ({
  AGENTS_REGISTRY: [],
  detectInstalledAgents: vi.fn(async () => []),
}));

const { registerRoutes } = await import("../api-routes.js");

function captureHandlers() {
  const handlers: Record<string, Record<string, any>> = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter = {
    get: vi.fn((path: string, h: any) => { handlers.get[path] = h; }),
    post: vi.fn((path: string, h: any) => { handlers.post[path] = h; }),
    put: vi.fn((path: string, h: any) => { handlers.put[path] = h; }),
    delete: vi.fn((path: string, h: any) => { handlers.delete[path] = h; }),
  };
  registerRoutes(fakeRouter as any, "/root");
  return handlers;
}

function fakeReq(url = "http://localhost/api/test") {
  return { url, headers: {} } as any;
}
function fakeRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    headersSent: false,
  } as any;
}

describe("0823 — /versions envelope adds provider + trackedForUpdates", () => {
  let versionsHandler: any;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillApiNameImpl.mockImplementation(async (skill: string) => skill);
    versionsHandler = captureHandlers().get["/api/skills/:plugin/:skill/versions"];
  });

  it("AC-US2-06: returns trackedForUpdates=true + provider='vskill' for a tracked skill", async () => {
    mocks.resolveSkillOrigin.mockResolvedValue({
      source: "platform",
      owner: "foo",
      repo: "bar",
      provider: "vskill",
      trackedForUpdates: true,
    });
    mocks.readLockfile.mockReturnValue({ skills: { nanobanana: { source: "github:foo/bar", version: "1.0.0" } } });
    mocks.parseSource.mockReturnValue({ type: "github", owner: "foo", repo: "bar" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versions: [{ version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-04-01" }] }),
    }));

    const req = fakeReq();
    const res = fakeRes();
    await versionsHandler(req, res, { plugin: ".claude", skill: "nanobanana" });

    const sent = mocks.sendJson.mock.calls[0][1];
    expect(sent.source).toBe("platform");
    expect(sent.provider).toBe("vskill");
    expect(sent.trackedForUpdates).toBe(true);
    expect(sent.count).toBe(1);
  });

  it("AC-US2-06: returns trackedForUpdates=false + provider='local' when no upstream resolves", async () => {
    mocks.resolveSkillOrigin.mockResolvedValue({
      source: "local",
      owner: null,
      repo: null,
      provider: "local",
      trackedForUpdates: false,
    });
    mocks.readLockfile.mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no upstream")));

    const req = fakeReq();
    const res = fakeRes();
    await versionsHandler(req, res, { plugin: ".claude", skill: "totally-unknown" });

    const sent = mocks.sendJson.mock.calls[0][1];
    expect(sent.source).toBe("none");
    expect(sent.provider).toBe("local");
    expect(sent.trackedForUpdates).toBe(false);
  });

  it("AC-US2-09: provider='anthropic' for Anthropic-shipped skills", async () => {
    // 0823 F-103 (iter 4 fix): use the verified-live owner/repo pattern
    // (anthropics/skills) — earlier draft used anthropic-skills/slack-messaging
    // which the platform 404s.
    mocks.resolveSkillOrigin.mockResolvedValue({
      source: "anthropic-registry",
      owner: "anthropics",
      repo: "skills",
      provider: "anthropic",
      trackedForUpdates: true,
      registryMatch: "slack-messaging",
    });
    mocks.readLockfile.mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versions: [{ version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-04-01" }] }),
    }));

    const req = fakeReq();
    const res = fakeRes();
    await versionsHandler(req, res, { plugin: ".claude", skill: "slack-messaging" });

    const sent = mocks.sendJson.mock.calls[0][1];
    expect(sent.provider).toBe("anthropic");
    expect(sent.trackedForUpdates).toBe(true);
  });

  it("AC-US2-06: trackedForUpdates=false even with platform source when versions list is empty", async () => {
    mocks.resolveSkillOrigin.mockResolvedValue({
      source: "platform",
      owner: "foo",
      repo: "bar",
      provider: "vskill",
      trackedForUpdates: true,
    });
    mocks.readLockfile.mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ versions: [] }),
    }));

    const req = fakeReq();
    const res = fakeRes();
    await versionsHandler(req, res, { plugin: ".claude", skill: "empty-upstream" });

    const sent = mocks.sendJson.mock.calls[0][1];
    expect(sent.trackedForUpdates).toBe(false);
    expect(sent.count).toBe(0);
  });
});
