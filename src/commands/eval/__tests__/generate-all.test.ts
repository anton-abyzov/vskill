import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock("../../../eval/llm.js", () => ({
  createLlmClient: () => ({
    generate: mockGenerate,
    model: "test-model",
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { runEvalGenerateAll } = await import("../generate-all.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

function createSkill(
  plugin: string,
  skill: string,
  opts: { evals?: boolean } = {},
): void {
  const skillDir = join(testDir, plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}\nDoes ${skill} things.`);

  if (opts.evals) {
    mkdirSync(join(skillDir, "evals"), { recursive: true });
    writeFileSync(
      join(skillDir, "evals", "evals.json"),
      JSON.stringify({
        skill_name: skill,
        evals: [
          {
            id: 1,
            name: "Existing",
            prompt: "test",
            expected_output: "output",
            assertions: [{ id: "a1", text: "check", type: "boolean" }],
          },
        ],
      }),
    );
  }
}

const VALID_GENERATED = `\`\`\`json
{
  "skill_name": "generated-skill",
  "evals": [
    {
      "id": 1,
      "name": "Generated test",
      "prompt": "Test prompt",
      "expected_output": "Expected output",
      "files": [],
      "assertions": [
        { "id": "a1", "text": "Check result", "type": "boolean" }
      ]
    }
  ]
}
\`\`\``;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvalGenerateAll", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-genall-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.resetAllMocks();
    mockGenerate.mockResolvedValue(VALID_GENERATED);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("generates for skills lacking evals", async () => {
    createSkill("marketing", "skill-a");
    createSkill("marketing", "skill-b");
    createSkill("marketing", "skill-c", { evals: true });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalGenerateAll(testDir, false);

    // skill-a and skill-b should get evals.json
    expect(
      existsSync(
        join(testDir, "marketing/skills/skill-a/evals/evals.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(testDir, "marketing/skills/skill-b/evals/evals.json"),
      ),
    ).toBe(true);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Generated: 2");
    expect(output).toContain("Skipped: 1");
  });

  it("skips skills with existing evals", async () => {
    createSkill("marketing", "existing-skill", { evals: true });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalGenerateAll(testDir, false);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Skipped: 1");
    expect(output).toContain("Generated: 0");
  });

  it("continues after LLM failure and reports it", async () => {
    createSkill("marketing", "fail-skill");
    createSkill("marketing", "ok-skill");
    let callCount = 0;
    mockGenerate.mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) throw new Error("API error");
      return VALID_GENERATED;
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runEvalGenerateAll(testDir, false);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Failed: 1");
  });

  it("regenerates with --force flag", async () => {
    createSkill("marketing", "existing-skill", { evals: true });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalGenerateAll(testDir, true);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Skipped: 0");
    expect(output).toContain("Generated: 1");
  });

  it("respects custom root for specweave-style layout", async () => {
    // Create a different root path
    const customRoot = join(testDir, "specweave-plugins");
    mkdirSync(customRoot, { recursive: true });
    const skillDir = join(customRoot, "core/skills/test-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Test\nDoes things.");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalGenerateAll(customRoot, false);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Scanned: 1");
    expect(output).toContain("Generated: 1");
  });
});
