// ---------------------------------------------------------------------------
// 0747 T-003: POST /api/skills/:plugin/:skill/update?agent=<id> MUST validate
// the agent id against AGENTS_REGISTRY (allowlist) before forwarding it as a
// `--agent <id>` flag to the underlying `vskill update` invocation. Unknown or
// shell-injection payloads MUST be rejected before any execFileSync call.
//
// 0747 code-review F-001 follow-up: implementation now uses `execFileSync`
// with an argv array (no shell). Tests mock execFileSync and assert on the
// args array, not a concatenated command string.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  readLockfile: vi.fn(),
  parseSource: vi.fn(),
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
  scanSkillsTriScope: vi.fn(async () => []),
  dedupeByDir: vi.fn((arr: unknown) => arr),
}));
vi.mock("../../eval/plugin-scanner.js", () => ({
  scanInstalledPluginSkills: vi.fn(() => []),
  scanAuthoredPluginSkills: vi.fn(() => []),
}));
vi.mock("../../eval/path-utils.js", () => ({
  resolveGlobalSkillsDir: vi.fn(),
}));
vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(),
  EvalValidationError: class extends Error {},
}));
vi.mock("../../eval/anthropic-catalog.js", () => ({
  ANTHROPIC_CATALOG_SNAPSHOT: { models: [] },
  findAnthropicModel: vi.fn(),
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
vi.mock("../../agents/agents-registry.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    detectInstalledAgents: vi.fn(async () => []),
  };
});
vi.mock("../../eval/env.js", () => ({ resolveOllamaBaseUrl: vi.fn() }));
vi.mock("../settings-store.js", () => ({}));
vi.mock("../providers.js", () => ({
  PROVIDERS: [],
  isProviderId: vi.fn(),
  getProviderById: vi.fn(),
}));
vi.mock("../darwin-migrator.js", () => ({
  DarwinKeychainMigrator: class {},
}));
vi.mock("../studio-json.js", () => ({
  loadStudioSelection: vi.fn(),
  saveStudioSelection: vi.fn(),
}));

import { registerRoutes } from "../api-routes.js";

type Handler = (
  req: unknown,
  res: unknown,
  params: Record<string, string>,
) => Promise<void>;

interface CapturedHandlers {
  post: Record<string, Handler>;
}

function captureHandlers(): CapturedHandlers {
  const post: Record<string, Handler> = {};
  const fakeRouter = {
    get: () => {},
    post: (p: string, h: Handler) => {
      post[p] = h;
    },
    put: () => {},
    delete: () => {},
  };
  registerRoutes(fakeRouter as never, "/tmp/fake-root");
  return { post };
}

function fakeReq(url: string): unknown {
  return { url, method: "POST", headers: { host: "localhost" } };
}
function fakeRes(): unknown {
  return {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    writeHead: () => {},
    end: () => {},
    write: () => {},
  };
}

describe("0747 T-003: POST /api/skills/:plugin/:skill/update?agent=<id>", () => {
  let handler: Handler;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = captureHandlers().post["/api/skills/:plugin/:skill/update"];
  });

  it("TC-001: forwards a known agent id as `--agent <id>` to vskill update", async () => {
    mocks.execFileSync.mockReturnValue("ok");
    await handler(
      fakeReq("http://localhost/api/skills/plug/architect/update?agent=claude-code"),
      fakeRes(),
      { plugin: "plug", skill: "architect" },
    );

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    const callArgs = mocks.execFileSync.mock.calls[0];
    expect(callArgs[0]).toBe("vskill");
    expect(callArgs[1]).toEqual(["update", "architect", "--agent", "claude-code"]);
  });

  it("TC-002: rejects an injection payload as the agent value WITHOUT calling execFileSync", async () => {
    await handler(
      fakeReq(
        `http://localhost/api/skills/plug/architect/update?agent=${encodeURIComponent("$(rm -rf /)")}`,
      ),
      fakeRes(),
      { plugin: "plug", skill: "architect" },
    );

    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.execSync).not.toHaveBeenCalled();
    // SSE error path is taken (or sendJson with 400 — depends on implementation).
    // Either way, NO process spawn.
  });

  it("TC-003: rejects an unknown agent id WITHOUT calling execFileSync", async () => {
    await handler(
      fakeReq("http://localhost/api/skills/plug/architect/update?agent=not-a-real-agent"),
      fakeRes(),
      { plugin: "plug", skill: "architect" },
    );

    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it("TC-004: omitting ?agent preserves existing behavior (no --agent flag)", async () => {
    mocks.execFileSync.mockReturnValue("ok");
    await handler(
      fakeReq("http://localhost/api/skills/plug/architect/update"),
      fakeRes(),
      { plugin: "plug", skill: "architect" },
    );

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    const callArgs = mocks.execFileSync.mock.calls[0];
    expect(callArgs[0]).toBe("vskill");
    expect(callArgs[1]).toEqual(["update", "architect"]);
  });

  it("TC-005 (F-001 regression): rejects shell-metachar payload in skill name without spawning a shell", async () => {
    // Two layers protect this endpoint:
    //   (a) a slug regex validator (F-002) rejects names containing spaces,
    //       semicolons, or other shell metachars — this fires FIRST.
    //   (b) execFileSync uses argv form, so even if (a) is ever loosened
    //       the metachars stay inert literal data to the child.
    // This test verifies (a): the spawn never happens for a metachar payload.
    const evilSkill = "foo;rm -rf /tmp/pwn";
    await handler(
      fakeReq(`http://localhost/api/skills/plug/${encodeURIComponent(evilSkill)}/update`),
      fakeRes(),
      { plugin: "plug", skill: evilSkill },
    );

    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it("TC-006 (F-002 regression): rejects a leading `--` skill name so Commander cannot interpret it as a flag", async () => {
    // `vskill update --force` (Commander) updates ALL installed skills,
    // bypassing the intended single-skill scope and any pinning. The slug
    // validator must reject any name beginning with `-`.
    const flagLike = "--force";
    await handler(
      fakeReq(`http://localhost/api/skills/plug/${encodeURIComponent(flagLike)}/update`),
      fakeRes(),
      { plugin: "plug", skill: flagLike },
    );

    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.execSync).not.toHaveBeenCalled();
  });
});
