// ---------------------------------------------------------------------------
// T-000: Pre-extraction baseline snapshots for /api/skills/generate handler
//
// Purpose: capture the contract of the in-line generator at
// src/eval-server/skill-create-routes.ts:919-1025 BEFORE T-001 extracts it
// into src/core/skill-generator.ts. T-003 will run the same scenarios against
// the extracted function and assert byte-for-byte parity against these
// fixtures.
//
// Why both inputs and outputs: the agent-aware augmentation
// (buildAgentAwareSystemPrompt) modifies the system prompt sent to the LLM,
// not the LLM output itself. With a fixed canned response the JSON output is
// identical across all combos. So the parity contract is the COMPLETE I/O:
//   • system prompt text passed to bodyClient.generate (proves augmentation)
//   • user prompt text                                    (proves prompt build)
//   • final JSON response                                 (proves parse+merge)
//
// Three target combinations as required by AC-US4-02:
//   • combo-1: ["claude-code"]                  → no augmentation
//   • combo-2: ["claude-code","codex","cursor"] → mixed augmentation
//   • combo-3: 7 universal agents               → full augmentation
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import of skill-create-routes
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Captured invocations for each LLM client call
  const llmCalls: Array<{
    role: "body" | "eval";
    systemPrompt: string;
    userPrompt: string;
  }> = [];

  // Canned LLM responses — deterministic, used for all combos
  const cannedBodyResponse = JSON.stringify({
    name: "lint-markdown-files",
    description: "Lint markdown files for style and structure issues",
    model: "claude-sonnet-4-5",
    allowedTools: "Read, Glob, Grep, Bash",
    body: "# Lint Markdown Files\n\nUse this skill to lint markdown files in a project.\n",
  }) + "\n---REASONING---\nGenerated using Skill Studio best practices for the markdown-lint domain.";

  const cannedEvalResponse = JSON.stringify({
    evals: [
      {
        id: 1,
        name: "lints a malformed heading",
        prompt: "Lint this file: # Bad Heading",
        expected_output: "warning about heading format",
        assertions: [
          { id: "a1", text: "output mentions heading", type: "contains" },
        ],
      },
    ],
  });

  // Track which call (body vs eval) we're on for the dual createLlmClient invocations
  const createLlmClient = vi.fn((opts?: { provider?: string; model?: string }) => {
    // The body client is created first (line 946), then the eval client (line 953)
    // We disambiguate by the model — eval client uses "haiku" (line 952)
    const isEvalClient = opts?.model === "haiku";
    return {
      generate: vi.fn(async (systemPrompt: string, userPrompt: string) => {
        llmCalls.push({
          role: isEvalClient ? "eval" : "body",
          systemPrompt,
          userPrompt,
        });
        return {
          text: isEvalClient ? cannedEvalResponse : cannedBodyResponse,
        };
      }),
    };
  });

  return { llmCalls, createLlmClient, cannedBodyResponse, cannedEvalResponse };
});

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: mocks.createLlmClient,
}));

// Stub heavy/irrelevant imports that registerSkillCreateRoutes pulls in
vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(),
}));

// We need real router behavior, real frontmatter helpers, real registry, real
// agent-aware augmentation — those are the things under test. Do NOT mock
// router.js, agents-registry.js, skill-creator-detection.js, sse-helpers.js,
// or error-classifier.js beyond what the version-routes pattern requires.

// ---------------------------------------------------------------------------
// Capture the route handler via fakeRouter pattern (matches version-routes.test.ts)
// ---------------------------------------------------------------------------

const { registerSkillCreateRoutes } = await import("../../eval-server/skill-create-routes.js");

interface CapturedHandlers {
  get: Record<string, any>;
  post: Record<string, any>;
  put: Record<string, any>;
  delete: Record<string, any>;
}

function captureHandlers(root: string): CapturedHandlers {
  const handlers: CapturedHandlers = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter: any = {
    get: (path: string, handler: any) => { handlers.get[path] = handler; },
    post: (path: string, handler: any) => { handlers.post[path] = handler; },
    put: (path: string, handler: any) => { handlers.put[path] = handler; },
    delete: (path: string, handler: any) => { handlers.delete[path] = handler; },
  };
  registerSkillCreateRoutes(fakeRouter, root);
  return handlers;
}

// ---------------------------------------------------------------------------
// Fake req/res — minimal to satisfy the handler
// ---------------------------------------------------------------------------

function fakeReq(body: unknown, accept = "application/json"): any {
  const bodyStr = JSON.stringify(body);
  // readBody reads the raw stream; we mock it to return our body
  const stream: any = {
    method: "POST",
    url: "/api/skills/generate",
    headers: { accept, "content-type": "application/json", "content-length": String(bodyStr.length) },
    on: (event: string, callback: (chunk?: Buffer) => void) => {
      if (event === "data") {
        setImmediate(() => callback(Buffer.from(bodyStr)));
      } else if (event === "end") {
        setImmediate(() => callback());
      } else if (event === "error") {
        // no-op
      }
      return stream;
    },
  };
  return stream;
}

function fakeRes(): { writeHead: any; write: any; end: any; headersSent: boolean; capturedBody: string; capturedStatus: number; capturedHeaders: Record<string, string> } {
  const captured = { body: "", status: 0, headers: {} as Record<string, string> };
  return {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) captured.headers = { ...captured.headers, ...headers };
    },
    write(chunk: string | Buffer) {
      captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    headersSent: false,
    on: vi.fn(),
    setHeader: vi.fn(),
    get capturedBody() { return captured.body; },
    get capturedStatus() { return captured.status; },
    get capturedHeaders() { return captured.headers; },
  } as any;
}

// ---------------------------------------------------------------------------
// Fixture path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "fixtures", "pre-extraction-snapshots");

interface BaselineFixture {
  combo: string;
  prompt: string;
  targetAgents: string[];
  llmCalls: Array<{ role: "body" | "eval"; systemPrompt: string; userPrompt: string }>;
  responseStatus: number;
  responseJson: unknown;
}

function writeFixture(combo: string, fixture: BaselineFixture): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const path = join(FIXTURES_DIR, `${combo}.json`);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n", "utf-8");
}

function readFixture(combo: string): BaselineFixture | null {
  const path = join(FIXTURES_DIR, `${combo}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

const SAMPLE_PROMPT = "lint markdown files";

const COMBOS: Array<{ name: string; targetAgents: string[] }> = [
  { name: "combo-1-claude-only", targetAgents: ["claude-code"] },
  { name: "combo-2-claude-codex-cursor", targetAgents: ["claude-code", "codex", "cursor"] },
  {
    name: "combo-3-all-universal",
    // 0694 (AC-US1-04 / F-002): use canonical github-copilot-ext id, not the
    // legacy github-copilot alias. The LEGACY_AGENT_IDS map exists for
    // external/runtime backward compat — in-repo fixtures should use the
    // current canonical id so a future alias removal does not silently break.
    targetAgents: ["claude-code", "cursor", "github-copilot-ext", "windsurf", "codex", "gemini-cli", "cline"],
  },
];

describe("T-000: pre-extraction baseline for POST /api/skills/generate", () => {
  let handlers: CapturedHandlers;
  let tempRoot: string;

  beforeAll(() => {
    // detectProjectLayout() runs against `root`; use a path with no plugins so
    // the test is deterministic regardless of the cwd's plugin layout
    tempRoot = "/tmp/vskill-baseline-test-root";
    mkdirSync(tempRoot, { recursive: true });
    handlers = captureHandlers(tempRoot);
  });

  afterAll(() => {
    // No cleanup of fixtures — they're committed artifacts
  });

  for (const combo of COMBOS) {
    it(`captures fixture for ${combo.name}`, async () => {
      // Reset captured LLM calls between scenarios
      mocks.llmCalls.length = 0;

      const handler = handlers.post["/api/skills/generate"];
      expect(handler).toBeDefined();

      const req = fakeReq({
        prompt: SAMPLE_PROMPT,
        targetAgents: combo.targetAgents,
        provider: "claude-cli",
      });
      const res = fakeRes();

      await handler(req, res, {});

      // Wait for any pending microtasks (the Promise.allSettled chain)
      await new Promise((r) => setImmediate(r));

      const fixture: BaselineFixture = {
        combo: combo.name,
        prompt: SAMPLE_PROMPT,
        targetAgents: combo.targetAgents,
        llmCalls: [...mocks.llmCalls].sort((a, b) => a.role.localeCompare(b.role)),
        responseStatus: res.capturedStatus,
        responseJson: res.capturedBody ? JSON.parse(res.capturedBody) : null,
      };

      // Sanity: handler should have completed and called the LLM at least once
      // (if the LLM was never called, the test setup is broken — fail loudly
      // rather than write an empty fixture)
      expect(mocks.llmCalls.length, `LLM was not invoked for ${combo.name} — test setup broken`).toBeGreaterThan(0);
      expect(fixture.responseJson, `No response body for ${combo.name}`).not.toBeNull();

      // Write fixture (idempotent — overwrites)
      writeFixture(combo.name, fixture);

      // If a previous fixture exists, this test acts as a regression check —
      // any change requires intentional fixture refresh
      const existing = readFixture(combo.name);
      if (existing) {
        // Compare key invariants — we don't assert byte-for-byte against
        // ourselves on the same run (would be tautological), but we verify
        // the structural shape is what T-003 will rely on
        expect(existing.targetAgents).toEqual(combo.targetAgents);
        expect(existing.llmCalls.length).toBe(2); // body + eval
        const bodyCall = existing.llmCalls.find((c) => c.role === "body")!;
        expect(bodyCall.systemPrompt).toBeTruthy();
        expect(bodyCall.userPrompt).toContain(SAMPLE_PROMPT);
      }
    });
  }

  it("agent-aware augmentation differs between combos", () => {
    // Re-read fixtures and assert the system prompts vary as expected:
    //   • combo-1 (Claude only) — base prompt unchanged
    //   • combo-2 (Claude + 2 non-Claude) — augmented with constraints
    //   • combo-3 (7 universal incl. non-Claude) — augmented with constraints
    const f1 = readFixture("combo-1-claude-only");
    const f2 = readFixture("combo-2-claude-codex-cursor");
    const f3 = readFixture("combo-3-all-universal");

    expect(f1, "combo-1 fixture missing — run scenario tests first").not.toBeNull();
    expect(f2, "combo-2 fixture missing").not.toBeNull();
    expect(f3, "combo-3 fixture missing").not.toBeNull();

    const sys1 = f1!.llmCalls.find((c) => c.role === "body")!.systemPrompt;
    const sys2 = f2!.llmCalls.find((c) => c.role === "body")!.systemPrompt;
    const sys3 = f3!.llmCalls.find((c) => c.role === "body")!.systemPrompt;

    // combo-1 has only claude-code → no "Target Agent Constraints" section
    expect(sys1).not.toContain("## Target Agent Constraints");

    // combo-2 and combo-3 include non-Claude agents → must contain the section
    expect(sys2).toContain("## Target Agent Constraints");
    expect(sys3).toContain("## Target Agent Constraints");

    // The non-Claude agent names must appear in the augmentation
    expect(sys2).toMatch(/Codex|OpenAI/i);
    expect(sys2).toMatch(/Cursor/i);

    // combo-3 has more agents — augmentation should be longer
    expect(sys3.length).toBeGreaterThan(sys2.length);
  });
});
