// ---------------------------------------------------------------------------
// 0792 T-003 — per-case `{ mode: "baseline" }` payload routes the run as a
// baseline: writeHistoryEntry receives `type: "baseline"` (not "benchmark"),
// and the system prompt fed to the LLM client is buildBaselineSystemPrompt(),
// not the eval/skill prompt.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmClient, GenerateResult } from "../../eval/llm.js";

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted ESM pattern, mirrors api-routes-put.test.ts)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  createLlmClient: vi.fn<(overrides?: { provider?: string; model?: string }) => LlmClient>(),
  judgeAssertion: vi.fn(),
  writeHistoryEntry: vi.fn(),
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
  withHeartbeat: vi.fn(
    (_res: unknown, _id: unknown, _phase: unknown, _msg: unknown, fn: () => unknown) => fn(),
  ),
  emitDataEvent: vi.fn(),
}));

vi.mock("../../eval/llm.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createLlmClient: mocks.createLlmClient,
  };
});

vi.mock("../../eval/judge.js", () => ({
  judgeAssertion: mocks.judgeAssertion,
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: mocks.writeHistoryEntry,
}));

vi.mock("../sse-helpers.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    initSSE: mocks.initSSE,
    sendSSE: mocks.sendSSE,
    sendSSEDone: mocks.sendSSEDone,
    withHeartbeat: mocks.withHeartbeat,
  };
});

vi.mock("../data-events.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    emitDataEvent: mocks.emitDataEvent,
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { registerRoutes } = await import("../api-routes.js");
const { buildBaselineSystemPrompt } = await import("../../eval/prompt-builder.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RouteHandler = (
  req: any,
  res: any,
  params: Record<string, string>,
) => Promise<void> | void;

function capturePerCaseHandler(): RouteHandler {
  let handler: RouteHandler | null = null;
  const fakeRouter = {
    get: vi.fn(),
    post: vi.fn((path: string, h: RouteHandler) => {
      if (path === "/api/skills/:plugin/:skill/benchmark/case/:evalId") {
        handler = h;
      }
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerRoutes(fakeRouter as any, "/root-not-used-direct-skilldir");
  if (!handler) throw new Error("per-case route handler not registered");
  return handler;
}

function makeFakeReq(body: unknown) {
  // readBody reads from req.on("data")/req.on("end"). Easiest: stub the
  // request as an async iterable that emits one chunk + ends.
  const json = JSON.stringify(body);
  const chunks = [Buffer.from(json, "utf-8")];
  return {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(json.length) },
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === "data") {
        for (const c of chunks) cb(c);
      } else if (event === "end") {
        cb();
      }
      return this;
    },
  };
}

function makeFakeRes() {
  return {
    write: vi.fn(),
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    flushHeaders: vi.fn(),
  } as any;
}

function makeTempSkill(opts: { withSkillMd: boolean }): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "vskill-0792-baseline-typing-"));
  mkdirSync(join(dir, "evals"), { recursive: true });
  writeFileSync(
    join(dir, "evals", "evals.json"),
    JSON.stringify({
      skill_name: "test-skill",
      evals: [
        {
          id: 1,
          name: "case-1",
          prompt: "say hi",
          expected_output: "hi back",
          assertions: [{ id: "a1", text: "responds politely", type: "boolean" }],
        },
      ],
    }),
    "utf-8",
  );
  if (opts.withSkillMd) {
    // Non-empty SKILL.md so buildEvalSystemPrompt does NOT collapse onto the
    // same string as buildBaselineSystemPrompt (the empty-content branch
    // returns "You are a helpful AI assistant." too).
    writeFileSync(
      join(dir, "SKILL.md"),
      "# Test Skill\n\nThis skill responds politely to greetings.\n",
      "utf-8",
    );
  }
  return {
    dir,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0792 T-003: per-case handler with { mode: 'baseline' }", () => {
  let handler: RouteHandler;
  let cleanups: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    handler = capturePerCaseHandler();

    // Default LLM client mock — captures the systemPrompt passed to generate().
    const generateMock = vi.fn<LlmClient["generate"]>(async (): Promise<GenerateResult> => ({
      text: "hi back",
      durationMs: 10,
      inputTokens: 5,
      outputTokens: 5,
    }));
    mocks.createLlmClient.mockImplementation((overrides) => ({
      model: overrides?.model ?? "sonnet",
      generate: generateMock,
    }) as LlmClient);

    mocks.judgeAssertion.mockResolvedValue({
      id: "a1",
      text: "responds politely",
      pass: true,
      reasoning: "ok",
    });
  });

  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("records type: 'baseline' and uses the baseline system prompt", async () => {
    const skill = makeTempSkill({ withSkillMd: true });
    cleanups.push(skill.cleanup);

    // Override resolveSkillDir resolution by patching params: the handler
    // calls `resolveSkillDir(root, plugin, skill)`. We bypass the registered
    // root by mocking skill-resolver below isn't necessary — instead we
    // monkeypatch via params and have skill-resolver return our tmp dir.
    // Cleanest: spy the export.
    const skillResolverMod = await import("../skill-resolver.js");
    const resolveSpy = vi
      .spyOn(skillResolverMod, "resolveSkillDir")
      .mockReturnValue(skill.dir);
    cleanups.push(() => resolveSpy.mockRestore());

    const req = makeFakeReq({
      mode: "baseline",
      provider: "claude-cli",
      model: "sonnet",
    });
    const res = makeFakeRes();

    await handler(req, res, { plugin: "test-plugin", skill: "test-skill", evalId: "1" });

    // ---- Assertion 1: writeHistoryEntry got type: "baseline" ----
    expect(mocks.writeHistoryEntry).toHaveBeenCalledTimes(1);
    const [, recordedResult] = mocks.writeHistoryEntry.mock.calls[0] as [string, { type: string }];
    expect(recordedResult.type).toBe("baseline");

    // ---- Assertion 2: client.generate received the baseline system prompt ----
    const clientInstance = mocks.createLlmClient.mock.results[0]?.value as LlmClient;
    expect(clientInstance).toBeDefined();
    const generateMock = clientInstance.generate as ReturnType<typeof vi.fn>;
    expect(generateMock).toHaveBeenCalledTimes(1);
    const [systemPromptArg, userPromptArg] = generateMock.mock.calls[0];
    expect(systemPromptArg).toBe(buildBaselineSystemPrompt());
    expect(userPromptArg).toBe("say hi");

    // The skill-content-derived eval prompt would have included "Test Skill"
    // when SKILL.md is non-empty — confirm the baseline path bypassed it.
    expect(systemPromptArg).not.toContain("Test Skill");
  });

  it("control: { } (default benchmark) uses the eval/skill prompt and records type 'benchmark'", async () => {
    const skill = makeTempSkill({ withSkillMd: true });
    cleanups.push(skill.cleanup);

    const skillResolverMod = await import("../skill-resolver.js");
    const resolveSpy = vi
      .spyOn(skillResolverMod, "resolveSkillDir")
      .mockReturnValue(skill.dir);
    cleanups.push(() => resolveSpy.mockRestore());

    const req = makeFakeReq({ provider: "claude-cli", model: "sonnet" }); // no mode
    const res = makeFakeRes();

    await handler(req, res, { plugin: "test-plugin", skill: "test-skill", evalId: "1" });

    expect(mocks.writeHistoryEntry).toHaveBeenCalledTimes(1);
    const [, recordedResult] = mocks.writeHistoryEntry.mock.calls[0] as [string, { type: string }];
    expect(recordedResult.type).toBe("benchmark");

    const clientInstance = mocks.createLlmClient.mock.results[0]?.value as LlmClient;
    const generateMock = clientInstance.generate as ReturnType<typeof vi.fn>;
    const [systemPromptArg] = generateMock.mock.calls[0];
    // Non-empty SKILL.md → eval prompt embeds the skill body.
    expect(systemPromptArg).toContain("Test Skill");
    expect(systemPromptArg).not.toBe(buildBaselineSystemPrompt());
  });
});
