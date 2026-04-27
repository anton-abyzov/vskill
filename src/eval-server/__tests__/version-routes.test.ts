// ---------------------------------------------------------------------------
// Unit tests for version proxy, diff, update, and batch-update routes
// T-009, T-010, T-011, T-012
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  readLockfile: vi.fn(),
  parseSource: vi.fn(),
  // 0747 F-001: source uses execFileSync (argv form, no shell) — execSync
  // remained as a hoisted mock for any legacy callsites but the
  // update/batch-update routes no longer touch it.
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  fetch: vi.fn(),
  resolveSkillApiNameImpl: vi.fn(),
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
  execSync: mocks.execSync,
  execFileSync: mocks.execFileSync,
}));

vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: mocks.readLockfile,
}));

vi.mock("../../resolvers/source-resolver.js", () => ({
  parseSource: mocks.parseSource,
}));

vi.mock("../skill-name-resolver.js", () => ({
  resolveSkillApiName: mocks.resolveSkillApiNameImpl,
  resetResolverCache: vi.fn(),
}));

// Stub everything else registerRoutes depends on
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
  emitDataEvent: vi.fn(),
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
vi.mock("../skill-resolver.js", () => ({ resolveSkillDir: vi.fn() }));
vi.mock("../../eval/skill-scanner.js", () => ({
  scanSkills: vi.fn(async () => []),
  classifyOrigin: vi.fn(),
}));
vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(),
  EvalValidationError: class extends Error {},
}));
vi.mock("../../eval/benchmark.js", () => ({
  readBenchmark: vi.fn(async () => null),
}));
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
vi.mock("../../eval/activation-tester.js", () => ({
  testActivation: vi.fn(),
}));
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

// ---------------------------------------------------------------------------
// Import and capture handlers
// ---------------------------------------------------------------------------

const { registerRoutes } = await import("../api-routes.js");

function captureHandlers(): Record<string, Record<string, any>> {
  const handlers: Record<string, Record<string, any>> = {
    get: {},
    post: {},
    put: {},
    delete: {},
  };
  const fakeRouter = {
    get: vi.fn((path: string, handler: any) => {
      handlers.get[path] = handler;
    }),
    post: vi.fn((path: string, handler: any) => {
      handlers.post[path] = handler;
    }),
    put: vi.fn((path: string, handler: any) => {
      handlers.put[path] = handler;
    }),
    delete: vi.fn((path: string, handler: any) => {
      handlers.delete[path] = handler;
    }),
  };
  registerRoutes(fakeRouter as any, "/root");
  return handlers;
}

// ---------------------------------------------------------------------------
// Helper: fake req/res
// ---------------------------------------------------------------------------

function fakeReq(url = "http://localhost/api/test"): any {
  return { url, headers: {} };
}

function fakeRes(): any {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    headersSent: false,
  };
}

// ---------------------------------------------------------------------------
// Shared lockfile fixture
// ---------------------------------------------------------------------------

const LOCK_FIXTURE = {
  version: 1,
  agents: [],
  skills: {
    architect: {
      version: "2.2.0",
      sha: "abc123",
      tier: "CERTIFIED",
      installedAt: "2026-01-01T00:00:00Z",
      source: "marketplace:anthropics/skills#architect",
    },
    pm: {
      version: "1.0.0",
      sha: "def456",
      tier: "VERIFIED",
      installedAt: "2026-01-01T00:00:00Z",
      source: "marketplace:anthropics/skills#pm",
    },
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// T-009: GET /api/skills/:plugin/:skill/versions
// ---------------------------------------------------------------------------

describe("T-009: GET /api/skills/:plugin/:skill/versions", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: resolver returns the bare skill name; individual tests can override.
    mocks.resolveSkillApiNameImpl.mockImplementation(async (skill: string) => skill);
    const handlers = captureHandlers();
    handler = handlers.get["/api/skills/:plugin/:skill/versions"];
  });

  it("is registered as a route", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("is registered BEFORE /:plugin/:skill catch-all", () => {
    const callOrder: string[] = [];
    const orderRouter = {
      get: vi.fn((path: string) => {
        callOrder.push(path);
      }),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    registerRoutes(orderRouter as any, "/root");

    const versionsIdx = callOrder.indexOf(
      "/api/skills/:plugin/:skill/versions",
    );
    const catchAllIdx = callOrder.indexOf("/api/skills/:plugin/:skill");
    expect(versionsIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(versionsIdx).toBeLessThan(catchAllIdx);
  });

  it("proxies to platform API and enriches with isInstalled", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anthropics/skills/architect");

    const platformVersions = {
      versions: [
        {
          version: "2.3.0",
          certTier: "CERTIFIED",
          createdAt: "2026-04-10",
          diffSummary: "Added multi-repo support",
        },
        {
          version: "2.2.0",
          certTier: "CERTIFIED",
          createdAt: "2026-03-28",
          diffSummary: "Fixed edge case",
        },
        {
          version: "2.1.0",
          certTier: "VERIFIED",
          createdAt: "2026-03-15",
          diffSummary: null,
        },
      ],
    };

    const fetchResp = {
      ok: true,
      json: async () => platformVersions,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchResp));

    const req = fakeReq("http://localhost/api/skills/myPlugin/architect/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    // Verify fetch was called with correct platform URL
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/skills/anthropics/skills/architect/versions"),
      expect.any(Object),
    );

    // 0707 T-021: response is now an envelope { versions, count, source }
    const sentData = mocks.sendJson.mock.calls[0][1];
    expect(sentData.source).toBe("platform");
    expect(sentData.count).toBe(3);
    expect(sentData.versions).toHaveLength(3);
    expect(sentData.versions[0].isInstalled).toBeFalsy(); // 2.3.0 not installed
    expect(sentData.versions[1].isInstalled).toBe(true); // 2.2.0 matches lockfile
    expect(sentData.versions[2].isInstalled).toBeFalsy(); // 2.1.0 not installed
  });

  // 0707 T-021: platform unreachable → 200 empty envelope + X-Skill-VCS header
  // (was 502). The UI must be able to render local/fixture skills without the
  // network being healthy.
  it("returns 200 empty envelope with X-Skill-VCS header when platform is unreachable", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anthropics/skills/architect");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );

    const req = fakeReq("http://localhost/api/skills/myPlugin/architect/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(res.setHeader).toHaveBeenCalledWith("X-Skill-VCS", "unavailable");
    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      { versions: [], count: 0, source: "none" },
      200,
      req,
    );
  });

  it("returns 200 empty envelope when platform API returns non-OK status", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anthropics/skills/architect");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const req = fakeReq("http://localhost/api/skills/myPlugin/architect/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(res.setHeader).toHaveBeenCalledWith("X-Skill-VCS", "unavailable");
    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      { versions: [], count: 0, source: "none" },
      200,
      req,
    );
  });

  it("handles skill not in lockfile gracefully", async () => {
    mocks.readLockfile.mockReturnValue({
      ...LOCK_FIXTURE,
      skills: {},
    });

    const platformVersions = {
      versions: [
        { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-01-01" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => platformVersions,
      }),
    );

    const req = fakeReq("http://localhost/api/skills/myPlugin/unknown/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "unknown" });

    // Should still proxy using plugin/skill as fallback name
    expect(fetch).toHaveBeenCalled();
    const sentData = mocks.sendJson.mock.calls[0][1];
    expect(sentData.source).toBe("platform");
    expect(sentData.count).toBe(1);
    expect(sentData.versions).toHaveLength(1);
    expect(sentData.versions[0].isInstalled).toBeFalsy();
  });

  it("accepts dash-containing plugin slugs (google-workspace/gws)", async () => {
    mocks.readLockfile.mockReturnValue({ ...LOCK_FIXTURE, skills: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ versions: [] }),
      }),
    );

    const req = fakeReq("http://localhost/api/skills/google-workspace/gws/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "google-workspace", skill: "gws" });

    const sentData = mocks.sendJson.mock.calls[0][1];
    expect(sentData).toEqual({ versions: [], count: 0, source: "platform" });
  });

  // ---------------------------------------------------------------------------
  // 0714: authored-skill proxy contract — fetches the hierarchical platform path
  // even when the lockfile has no entry, exercising AC-US1-02 / AC-US2-02.
  // ---------------------------------------------------------------------------
  it("0714: authored skill proxies to /api/v1/skills/{owner}/{repo}/{skill}/versions", async () => {
    mocks.readLockfile.mockReturnValue(null); // No lockfile entry — authored path.
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anton-abyzov/vskill/appstore");

    const platformVersions = {
      versions: [
        { version: "1.0.1", certTier: "CERTIFIED", createdAt: "2026-04-05", diffSummary: "Content updated" },
        { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-04-05", diffSummary: null },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => platformVersions }),
    );

    const req = fakeReq("http://localhost/api/skills/mobile/appstore/versions");
    const res = fakeRes();

    await handler(req, res, { plugin: "mobile", skill: "appstore" });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/skills/anton-abyzov/vskill/appstore/versions"),
      expect.any(Object),
    );

    const sentData = mocks.sendJson.mock.calls[0][1];
    expect(sentData.source).toBe("platform");
    expect(sentData.count).toBe(2);
    expect(sentData.versions.map((v: any) => v.version)).toEqual(["1.0.1", "1.0.0"]);
  });
});

// ---------------------------------------------------------------------------
// T-010: GET /api/skills/:plugin/:skill/versions/diff
// ---------------------------------------------------------------------------

describe("T-010: GET /api/skills/:plugin/:skill/versions/diff", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillApiNameImpl.mockImplementation(async (skill: string) => skill);
    const handlers = captureHandlers();
    handler = handlers.get["/api/skills/:plugin/:skill/versions/diff"];
  });

  // 0714: authored-skill proxy contract for diff endpoint (AC-US2-01).
  it("0714: authored skill proxies diff to /api/v1/skills/{owner}/{repo}/{skill}/versions/diff", async () => {
    mocks.readLockfile.mockReturnValue(null);
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anton-abyzov/vskill/appstore");

    const platformDiff = { from: "1.0.0", to: "1.0.1", diffSummary: "Content updated", contentDiff: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => platformDiff }),
    );

    const req = fakeReq(
      "http://localhost/api/skills/mobile/appstore/versions/diff?from=1.0.0&to=1.0.1",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "mobile", skill: "appstore" });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/skills/anton-abyzov/vskill/appstore/versions/diff?"),
      expect.any(Object),
    );
  });

  it("is registered as a route", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("proxies diff to platform and returns unchanged", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });

    const diffPayload = {
      from: "1.0.0",
      to: "2.0.0",
      diffSummary: "Added new features",
      contentDiff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-old\n+new",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => diffPayload,
      }),
    );

    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?from=1.0.0&to=2.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    // Verify platform URL includes from/to params
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("from=1.0.0"),
      expect.any(Object),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("to=2.0.0"),
      expect.any(Object),
    );

    // Verify response passed through
    expect(mocks.sendJson).toHaveBeenCalledWith(res, diffPayload, 200, req);
  });

  it("returns 400 when from param is missing", async () => {
    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?to=2.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ error: expect.stringContaining("from") }),
      400,
      req,
    );
  });

  it("returns 400 when to param is missing", async () => {
    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?from=1.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ error: expect.stringContaining("to") }),
      400,
      req,
    );
  });

  it("returns 502 when platform is unreachable", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("anthropics/skills/architect");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("timeout")),
    );

    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?from=1.0.0&to=2.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      { error: "Platform API unavailable" },
      502,
      req,
    );
  });

  // 0746: pass-through — non-2xx upstream MUST NOT be masked as 502.
  // Only true network failure (fetch throws) is platform_unreachable.

  it("0746 AC-US1-01: forwards upstream 400 status + body unchanged", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anton-abyzov",
      repo: "greet-anton",
      pluginName: "greet-anton",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue(
      "anton-abyzov/greet-anton/greet-anton",
    );

    const upstreamBody = { error: "Version '1.0.1' not found" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => upstreamBody,
      }),
    );

    const req = fakeReq(
      "http://localhost/api/skills/greet-anton/greet-anton/versions/diff?from=1.0.1&to=1.0.2",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "greet-anton", skill: "greet-anton" });

    expect(mocks.sendJson).toHaveBeenCalledWith(res, upstreamBody, 400, req);
    expect(mocks.sendJson).not.toHaveBeenCalledWith(
      res,
      { error: "Platform API unavailable" },
      502,
      req,
    );
  });

  it("0746 AC-US1-02: forwards upstream 404 status + body unchanged", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "x",
      repo: "y",
      pluginName: "z",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("x/y/z");

    const upstreamBody = { error: "Skill not found" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => upstreamBody,
      }),
    );

    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?from=1.0.0&to=2.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.sendJson).toHaveBeenCalledWith(res, upstreamBody, 404, req);
  });

  it("0746 AC-US1-03: non-JSON upstream body falls back to {error: 'Upstream returned <status>'}", async () => {
    mocks.readLockfile.mockReturnValue(LOCK_FIXTURE);
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "x",
      repo: "y",
      pluginName: "z",
    });
    mocks.resolveSkillApiNameImpl.mockResolvedValue("x/y/z");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    const req = fakeReq(
      "http://localhost/api/skills/myPlugin/architect/versions/diff?from=1.0.0&to=2.0.0",
    );
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.sendJson).toHaveBeenCalledWith(
      res,
      { error: "Upstream returned 503" },
      503,
      req,
    );
  });
});

// ---------------------------------------------------------------------------
// T-011: POST /api/skills/:plugin/:skill/update
// ---------------------------------------------------------------------------

describe("T-011: POST /api/skills/:plugin/:skill/update", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    const handlers = captureHandlers();
    handler = handlers.post["/api/skills/:plugin/:skill/update"];
  });

  it("is registered as a route", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("streams SSE progress and done on successful update", async () => {
    // 0747 F-001: source uses execFileSync (argv form), not execSync.
    mocks.execFileSync.mockReturnValue("Updated architect 2.2.0 -> 2.3.0");

    const req = fakeReq("http://localhost/api/skills/myPlugin/architect/update");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.initSSE).toHaveBeenCalledWith(res, req);
    expect(mocks.sendSSE).toHaveBeenCalledWith(
      res,
      "progress",
      expect.objectContaining({ status: "updating", skill: "architect" }),
    );
    expect(mocks.sendSSEDone).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ status: "done" }),
    );
  });

  it("streams SSE error when update fails", async () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error("scan FAILED");
    });

    const req = fakeReq("http://localhost/api/skills/myPlugin/architect/update");
    const res = fakeRes();

    await handler(req, res, { plugin: "myPlugin", skill: "architect" });

    expect(mocks.initSSE).toHaveBeenCalledWith(res, req);
    expect(mocks.sendSSE).toHaveBeenCalledWith(
      res,
      "error",
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(mocks.sendSSEDone).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-012: POST /api/skills/batch-update
// ---------------------------------------------------------------------------

describe("T-012: POST /api/skills/batch-update", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    const handlers = captureHandlers();
    handler = handlers.post["/api/skills/batch-update"];
  });

  it("is registered as a route", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("processes skills sequentially with per-skill SSE events", async () => {
    mocks.readBody.mockResolvedValue({
      skills: ["architect", "pm"],
    });
    // 0747 F-001: batch route uses execFileSync (argv form).
    mocks.execFileSync.mockReturnValue("ok");

    const req = fakeReq("http://localhost/api/skills/batch-update");
    const res = fakeRes();

    await handler(req, res);

    expect(mocks.initSSE).toHaveBeenCalledWith(res, req);

    // Verify skill:start events for both skills
    const sseEvents = mocks.sendSSE.mock.calls.map(
      (c: any[]) => [c[1], c[2]] as [string, any],
    );

    const startEvents = sseEvents.filter(([e]) => e === "skill:start");
    expect(startEvents).toHaveLength(2);
    expect(startEvents[0][1].skill).toBe("architect");
    expect(startEvents[1][1].skill).toBe("pm");

    // Verify skill:done events
    const doneEvents = sseEvents.filter(([e]) => e === "skill:done");
    expect(doneEvents).toHaveLength(2);

    // Verify final batch:done
    expect(mocks.sendSSEDone).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ updated: 2, failed: 0 }),
    );
  });

  it("continues processing when one skill fails", async () => {
    mocks.readBody.mockResolvedValue({
      skills: ["architect", "pm"],
    });
    // 0747 F-001: batch route uses execFileSync. First skill fails, second succeeds.
    mocks.execFileSync
      .mockImplementationOnce(() => {
        throw new Error("scan FAILED");
      })
      .mockReturnValueOnce("ok");

    const req = fakeReq("http://localhost/api/skills/batch-update");
    const res = fakeRes();

    await handler(req, res);

    const sseEvents = mocks.sendSSE.mock.calls.map(
      (c: any[]) => [c[1], c[2]] as [string, any],
    );

    // First skill should have skill:error
    const errorEvents = sseEvents.filter(([e]) => e === "skill:error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0][1].skill).toBe("architect");

    // Second skill should have skill:done
    const doneEvents = sseEvents.filter(([e]) => e === "skill:done");
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0][1].skill).toBe("pm");

    // batch:done summary
    expect(mocks.sendSSEDone).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ updated: 1, failed: 1 }),
    );
  });

  it("returns 409 when batch update is already in progress", async () => {
    // Use a deferred readBody to keep the first handler "in progress"
    // while we fire the second call. The flag is set before readBody.
    let resolveFirst!: (v: any) => void;
    const deferredBody = new Promise((r) => {
      resolveFirst = r;
    });
    mocks.readBody.mockReturnValueOnce(deferredBody);
    mocks.execFileSync.mockReturnValue("ok");

    const req1 = fakeReq("http://localhost/api/skills/batch-update");
    const res1 = fakeRes();
    const req2 = fakeReq("http://localhost/api/skills/batch-update");
    const res2 = fakeRes();

    // Start first batch — don't await; it blocks on readBody
    const firstCall = handler(req1, res1);

    // Yield to let the first handler reach the readBody await
    await Promise.resolve();

    // Second batch should get 409 since flag is already set
    await handler(req2, res2);

    expect(mocks.sendJson).toHaveBeenCalledWith(
      res2,
      { error: "Update already in progress" },
      409,
      req2,
    );

    // Clean up first call
    resolveFirst({ skills: ["architect"] });
    await firstCall;
  });
});
