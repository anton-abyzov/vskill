import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("../../../eval/llm.js", () => ({
  createLlmClient: () => ({
    generate: mocks.generate,
    model: "test-model",
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { runEvalInit } = await import("../init.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_GENERATED = `Here is the evals.json:

\`\`\`json
{
  "skill_name": "test-skill",
  "evals": [
    {
      "id": 1,
      "name": "Basic test",
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

describe("runEvalInit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: SKILL.md exists, evals.json does not
    mocks.existsSync.mockImplementation((p: string) => {
      if (p.includes("SKILL.md")) return true;
      if (p.includes("evals.json")) return false;
      return false;
    });
    mocks.readFileSync.mockReturnValue("# My Skill\nDoes things.");
    mocks.generate.mockResolvedValue(VALID_GENERATED);
  });

  it("creates evals.json when absent", async () => {
    await runEvalInit("/root/plugins/marketing/skills/social-media-posting", false);

    expect(mocks.mkdirSync).toHaveBeenCalled();
    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
    const writtenContent = JSON.parse(mocks.writeFileSync.mock.calls[0][1]);
    expect(writtenContent.skill_name).toBe("test-skill");
    expect(writtenContent.evals).toHaveLength(1);
  });

  it("exits with message when evals.json exists and no --force", async () => {
    mocks.existsSync.mockImplementation((p: string) => {
      if (p.includes("SKILL.md")) return true;
      if (p.includes("evals.json")) return true;
      return false;
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalInit("/root/plugins/marketing/skills/smp", false);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("overwrites when --force flag is passed", async () => {
    mocks.existsSync.mockImplementation((p: string) => {
      if (p.includes("SKILL.md")) return true;
      if (p.includes("evals.json")) return true;
      return false;
    });

    await runEvalInit("/root/plugins/marketing/skills/smp", true);

    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
  });

  it("handles LLM failure gracefully", async () => {
    mocks.generate.mockRejectedValue(new Error("API rate limited"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runEvalInit("/root/plugins/marketing/skills/smp", false);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("API rate limited"),
    );
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("throws when SKILL.md does not exist", async () => {
    mocks.existsSync.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runEvalInit("/root/plugins/marketing/skills/smp", false);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("SKILL.md"),
    );
    consoleSpy.mockRestore();
  });
});
