// ---------------------------------------------------------------------------
// T-003: post-extraction byte-for-byte parity test for generateSkill().
//
// Loads the T-000 baseline fixtures from fixtures/pre-extraction-snapshots/
// and replays the same three target combinations against the EXTRACTED
// generateSkill() implementation. Asserts complete parity:
//   • system prompts (proves buildAgentAwareSystemPrompt augmentation is
//     invoked with identical inputs)
//   • user prompts (proves bodyPrompt/evalPrompt templates are unchanged)
//   • final GenerateSkillResult JSON (proves parse+merge is unchanged)
//
// If this suite passes alongside baseline.test.ts, the extraction is
// behavior-preserving (modulo the `suggestedPlugin` field which is attached
// at the transport layer, not by generateSkill itself).
// ---------------------------------------------------------------------------

import { beforeAll, describe, it, expect, vi } from "vitest";
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Same mocks as skill-generator.test.ts — canned LLM responses must match
// those used by baseline.test.ts so the fixtures are reproducible.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const llmCalls: Array<{
    role: "body" | "eval";
    systemPrompt: string;
    userPrompt: string;
  }> = [];

  const CANNED_BODY =
    JSON.stringify({
      name: "lint-markdown-files",
      description: "Lint markdown files for style and structure issues",
      model: "claude-sonnet-4-5",
      allowedTools: "Read, Glob, Grep, Bash",
      body: "# Lint Markdown Files\n\nUse this skill to lint markdown files in a project.\n",
    }) +
    "\n---REASONING---\nGenerated using Skill Studio best practices for the markdown-lint domain.";

  const CANNED_EVALS = JSON.stringify({
    evals: [
      {
        id: 1,
        name: "lints a malformed heading",
        prompt: "Lint this file: # Bad Heading",
        expected_output: "warning about heading format",
        assertions: [{ id: "a1", text: "output mentions heading", type: "contains" }],
      },
    ],
  });

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
        return {
          text: isEvalClient ? CANNED_EVALS : CANNED_BODY,
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
  responseJson: Record<string, unknown>;
}

const readFixture = (combo: string): BaselineFixture =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, `${combo}.json`), "utf-8"));

// ---------------------------------------------------------------------------
// Scenarios — mirror T-000 COMBOS in baseline.test.ts exactly
// ---------------------------------------------------------------------------

const COMBOS = [
  { name: "combo-1-claude-only", targetAgents: ["claude-code"] },
  { name: "combo-2-claude-codex-cursor", targetAgents: ["claude-code", "codex", "cursor"] },
  {
    name: "combo-3-all-universal",
    targetAgents: [
      "claude-code",
      "cursor",
      "github-copilot-ext",
      "windsurf",
      "codex",
      "gemini-cli",
      "cline",
    ],
  },
] as const;

const TEMP_ROOT = "/tmp/vskill-skill-generator-parity-test-root";

describe("T-003 parity: generateSkill() vs T-000 baseline fixtures", () => {
  beforeAll(() => {
    mkdirSync(TEMP_ROOT, { recursive: true });
  });

  for (const combo of COMBOS) {
    describe(combo.name, () => {
      it("reproduces the body system prompt byte-for-byte", async () => {
        mocks.llmCalls.length = 0;
        await generateSkill(
          {
            prompt: "lint markdown files",
            targetAgents: [...combo.targetAgents],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        const fixture = readFixture(combo.name);
        const actual = mocks.llmCalls.find((c) => c.role === "body")!;
        const expected = fixture.llmCalls.find((c) => c.role === "body")!;
        expect(actual.systemPrompt).toBe(expected.systemPrompt);
      });

      it("reproduces the body user prompt byte-for-byte", async () => {
        mocks.llmCalls.length = 0;
        await generateSkill(
          {
            prompt: "lint markdown files",
            targetAgents: [...combo.targetAgents],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        const fixture = readFixture(combo.name);
        const actual = mocks.llmCalls.find((c) => c.role === "body")!;
        const expected = fixture.llmCalls.find((c) => c.role === "body")!;
        expect(actual.userPrompt).toBe(expected.userPrompt);
      });

      it("reproduces the eval system + user prompts byte-for-byte", async () => {
        mocks.llmCalls.length = 0;
        await generateSkill(
          {
            prompt: "lint markdown files",
            targetAgents: [...combo.targetAgents],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        const fixture = readFixture(combo.name);
        const actual = mocks.llmCalls.find((c) => c.role === "eval")!;
        const expected = fixture.llmCalls.find((c) => c.role === "eval")!;
        expect(actual.systemPrompt).toBe(expected.systemPrompt);
        expect(actual.userPrompt).toBe(expected.userPrompt);
      });

      it("reproduces the final GenerateSkillResult JSON (minus suggestedPlugin)", async () => {
        mocks.llmCalls.length = 0;
        const result = await generateSkill(
          {
            prompt: "lint markdown files",
            targetAgents: [...combo.targetAgents],
            provider: "claude-cli",
            model: "sonnet",
          },
          { root: TEMP_ROOT },
        );

        const fixture = readFixture(combo.name);
        // Baseline fixture includes suggestedPlugin (attached by the HTTP
        // handler's transport-layer wrapper). The extracted generator itself
        // is free of plugin-matching side effects, so we strip that field
        // before comparison.
        const { suggestedPlugin: _, ...expected } = fixture.responseJson as Record<
          string,
          unknown
        > & { suggestedPlugin?: unknown };
        void _;

        expect(result).toStrictEqual(expected);
      });
    });
  }
});
