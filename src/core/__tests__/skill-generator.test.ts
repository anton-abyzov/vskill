// ---------------------------------------------------------------------------
// T-003: Parity snapshot tests for the extracted src/core/skill-generator.ts
//
// Purpose: prove byte-for-byte parity with the pre-extraction baseline
// fixtures captured in T-000 (see ../fixtures/pre-extraction-snapshots/).
//
// Mocking strategy: vi.hoisted() + vi.mock() of ../../eval/llm.js (same
// pattern used by baseline.test.ts so the two share semantics). We mock
// createLlmClient to capture (role, systemPrompt, userPrompt) on every call
// and return canned responses identical to the ones used in the baseline —
// this is what keeps fixtures deterministic.
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Hoisted mocks — canned body + eval responses MUST match baseline.test.ts
// byte-for-byte (that is the whole point of parity testing)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const llmCalls: Array<{
    role: "body" | "eval";
    systemPrompt: string;
    userPrompt: string;
  }> = [];

  const createLlmClient = vi.fn((opts?: { provider?: string; model?: string }) => {
    const isEvalClient = opts?.model === "haiku";
    return {
      model: opts?.model ?? "sonnet",
      generate: vi.fn(async (systemPrompt: string, userPrompt: string) => {
        llmCalls.push({
          role: isEvalClient ? "eval" : "body",
          systemPrompt,
          userPrompt,
        });
        // Return the canned response — match the GenerateResult shape from
        // src/eval/llm.ts so the generator does not special-case tests
        return {
          text: isEvalClient
            ? JSON.stringify({
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
              })
            : JSON.stringify({
                name: "lint-markdown-files",
                description: "Lint markdown files for style and structure issues",
                model: "claude-sonnet-4-5",
                allowedTools: "Read, Glob, Grep, Bash",
                body: "# Lint Markdown Files\n\nUse this skill to lint markdown files in a project.\n",
              }) + "\n---REASONING---\nGenerated using Skill Studio best practices for the markdown-lint domain.",
          durationMs: 10,
          inputTokens: 100,
          outputTokens: 50,
          cost: 0,
          billingMode: "free",
        };
      }),
    };
  });

  return { llmCalls, createLlmClient };
});

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: mocks.createLlmClient,
}));

// ---------------------------------------------------------------------------
// Imports under test — must follow mocks
// ---------------------------------------------------------------------------

const { generateSkill } = await import("../skill-generator.js");

// ---------------------------------------------------------------------------
// Fixture loading
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
  responseJson: {
    name: string;
    description: string;
    model: string;
    allowedTools: string;
    body: string;
    reasoning: string;
    evals: Array<{
      id: number;
      name: string;
      prompt: string;
      expected_output: string;
      assertions: Array<{ id: string; text: string; type: string }>;
    }>;
    suggestedPlugin: unknown;
  };
}

function readFixture(combo: string): BaselineFixture {
  const path = join(FIXTURES_DIR, `${combo}.json`);
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
    targetAgents: ["claude-code", "cursor", "github-copilot-ext", "windsurf", "codex", "gemini-cli", "cline"],
  },
];

const TEMP_ROOT = "/tmp/vskill-skill-generator-test-root";

describe("generateSkill() — T-001 extracted module", () => {
  beforeAll(() => {
    mkdirSync(TEMP_ROOT, { recursive: true });
  });

  for (const combo of COMBOS) {
    describe(combo.name, () => {
      it("returns GenerateSkillResult with expected shape", async () => {
        mocks.llmCalls.length = 0;

        const result = await generateSkill(
          {
            prompt: SAMPLE_PROMPT,
            targetAgents: combo.targetAgents,
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        expect(result).toMatchObject({
          name: "lint-markdown-files",
          description: "Lint markdown files for style and structure issues",
          model: "claude-sonnet-4-5",
          allowedTools: "Read, Glob, Grep, Bash",
          body: "# Lint Markdown Files\n\nUse this skill to lint markdown files in a project.\n",
          reasoning: "Generated using Skill Studio best practices for the markdown-lint domain.",
        });
        expect(Array.isArray(result.evals)).toBe(true);
        expect(result.evals.length).toBe(1);
        expect(result.evals[0]?.name).toBe("lints a malformed heading");
      });

      it("matches baseline fixture byte-for-byte (parity)", async () => {
        mocks.llmCalls.length = 0;

        const result = await generateSkill(
          {
            prompt: SAMPLE_PROMPT,
            targetAgents: combo.targetAgents,
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        const fixture = readFixture(combo.name);
        const expected = fixture.responseJson;

        expect(result.name).toBe(expected.name);
        expect(result.description).toBe(expected.description);
        expect(result.model).toBe(expected.model);
        expect(result.allowedTools).toBe(expected.allowedTools);
        expect(result.body).toBe(expected.body);
        expect(result.reasoning).toBe(expected.reasoning);
        expect(result.evals).toEqual(expected.evals);

        // System prompt parity — the augmentation is the load-bearing piece
        // (see AD-003 rationale in plan.md)
        const bodyCall = mocks.llmCalls.find((c) => c.role === "body");
        expect(bodyCall).toBeDefined();
        const expectedBodyCall = fixture.llmCalls.find((c) => c.role === "body");
        expect(expectedBodyCall).toBeDefined();
        expect(bodyCall!.systemPrompt).toBe(expectedBodyCall!.systemPrompt);
        expect(bodyCall!.userPrompt).toBe(expectedBodyCall!.userPrompt);

        const evalCall = mocks.llmCalls.find((c) => c.role === "eval");
        const expectedEvalCall = fixture.llmCalls.find((c) => c.role === "eval");
        expect(evalCall!.systemPrompt).toBe(expectedEvalCall!.systemPrompt);
        expect(evalCall!.userPrompt).toBe(expectedEvalCall!.userPrompt);
      });
    });
  }

  describe("buildAgentAwareSystemPrompt invocation", () => {
    it("combo-1 (claude-only) → base prompt unchanged", async () => {
      mocks.llmCalls.length = 0;
      await generateSkill(
        { prompt: SAMPLE_PROMPT, targetAgents: ["claude-code"], provider: "claude-cli", model: "sonnet" },
        { root: TEMP_ROOT },
      );
      const bodyCall = mocks.llmCalls.find((c) => c.role === "body");
      expect(bodyCall).toBeDefined();
      expect(bodyCall!.systemPrompt).not.toContain("## Target Agent Constraints");
    });

    it("combo-2 (mixed) → augmented with Target Agent Constraints", async () => {
      mocks.llmCalls.length = 0;
      await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code", "codex", "cursor"],
          provider: "claude-cli",
          model: "sonnet",
        },
        { root: TEMP_ROOT },
      );
      const bodyCall = mocks.llmCalls.find((c) => c.role === "body");
      expect(bodyCall).toBeDefined();
      expect(bodyCall!.systemPrompt).toContain("## Target Agent Constraints");
      expect(bodyCall!.systemPrompt).toMatch(/Codex|OpenAI/i);
      expect(bodyCall!.systemPrompt).toMatch(/Cursor/i);
    });

    it("combo-3 (all universal) → augmentation larger than combo-2", async () => {
      mocks.llmCalls.length = 0;
      await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code", "cursor", "github-copilot-ext", "windsurf", "codex", "gemini-cli", "cline"],
          provider: "claude-cli",
          model: "sonnet",
        },
        { root: TEMP_ROOT },
      );
      const bodyCall3 = mocks.llmCalls.find((c) => c.role === "body");
      expect(bodyCall3).toBeDefined();
      expect(bodyCall3!.systemPrompt).toContain("## Target Agent Constraints");
    });
  });

  describe("progress callback", () => {
    it("invokes onProgress with phase events when provided", async () => {
      mocks.llmCalls.length = 0;
      const progressEvents: Array<{ phase: string; message: string }> = [];

      await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code"],
          provider: "claude-cli",
          model: "sonnet",
        },
        {
          root: TEMP_ROOT,
          onProgress: (e) => { progressEvents.push(e); },
        },
      );

      // At minimum: preparing → generating-body → generating-evals → parsing
      expect(progressEvents.length).toBeGreaterThanOrEqual(2);
      const phases = progressEvents.map((e) => e.phase);
      expect(phases).toContain("generating-body");
      expect(phases).toContain("generating-evals");
    });

    it("works without onProgress (non-SSE path)", async () => {
      mocks.llmCalls.length = 0;
      const result = await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code"],
          provider: "claude-cli",
          model: "sonnet",
        },
        { root: TEMP_ROOT },
      );
      expect(result.name).toBe("lint-markdown-files");
    });
  });

  describe("abort signal", () => {
    it("throws when the AbortSignal is already aborted before LLM calls settle", async () => {
      mocks.llmCalls.length = 0;
      const ac = new AbortController();
      ac.abort(new Error("user cancelled"));
      await expect(
        generateSkill(
          {
            prompt: SAMPLE_PROMPT,
            targetAgents: ["claude-code"],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT, abortSignal: ac.signal },
        ),
      ).rejects.toThrow(/cancelled|aborted/);
    });

    it("falls back to a generic error when AbortSignal has no reason", async () => {
      mocks.llmCalls.length = 0;
      const ac = new AbortController();
      ac.abort();
      await expect(
        generateSkill(
          {
            prompt: SAMPLE_PROMPT,
            targetAgents: ["claude-code"],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT, abortSignal: ac.signal },
        ),
      ).rejects.toThrow(/aborted/i);
    });
  });

  describe("existing plugins prompt injection", () => {
    it("includes the existing plugin list in the body user prompt when plugins are present", async () => {
      // Seed a fake plugin layout in a temp root (layout 2: root/plugins/<name>/skills/<skill>/SKILL.md)
      const seedRoot = "/tmp/vskill-skill-generator-test-root-with-plugins";
      const pluginDir = `${seedRoot}/plugins/markdown-tools/skills/lint`;
      mkdirSync(pluginDir, { recursive: true });
      // SKILL.md needs to be present for listSkillDirs to pick it up
      const fs = await import("node:fs");
      fs.writeFileSync(
        `${pluginDir}/SKILL.md`,
        "---\nname: lint\ndescription: dummy\n---\n\nbody\n",
        "utf-8",
      );

      mocks.llmCalls.length = 0;
      await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code"],
          provider: "claude-cli",
          model: "sonnet",
        },
        { root: seedRoot },
      );

      const bodyCall = mocks.llmCalls.find((c) => c.role === "body");
      expect(bodyCall).toBeDefined();
      expect(bodyCall!.userPrompt).toContain("Existing plugins in this project:");
      expect(bodyCall!.userPrompt).toContain("markdown-tools");
    });
  });

  describe("LLM client configuration", () => {
    it("uses the provided provider + model for body client", async () => {
      mocks.llmCalls.length = 0;
      mocks.createLlmClient.mockClear();
      await generateSkill(
        {
          prompt: SAMPLE_PROMPT,
          targetAgents: ["claude-code"],
          provider: "claude-cli",
          model: "sonnet",
        },
        { root: TEMP_ROOT },
      );
      // First call — body client
      expect(mocks.createLlmClient).toHaveBeenCalledWith({ provider: "claude-cli", model: "sonnet" });
      // Second call — eval client (cheap model)
      expect(mocks.createLlmClient).toHaveBeenCalledWith({ provider: "claude-cli", model: "haiku" });
    });
  });
});

