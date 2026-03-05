import { describe, it, expect } from "vitest";
import {
  buildEvalInitPrompt,
  parseGeneratedEvals,
} from "../prompt-builder.js";

// ---------------------------------------------------------------------------
// buildEvalInitPrompt
// ---------------------------------------------------------------------------

describe("buildEvalInitPrompt", () => {
  const skillContent = "# My Skill\nThis skill does amazing things.";

  it("includes skill content in the prompt", () => {
    const prompt = buildEvalInitPrompt(skillContent);
    expect(prompt).toContain(skillContent);
  });

  it("includes schema reference fields", () => {
    const prompt = buildEvalInitPrompt(skillContent);
    expect(prompt).toContain("skill_name");
    expect(prompt).toContain("assertions");
    expect(prompt).toContain("expected_output");
  });

  it("includes social-media-posting example", () => {
    const prompt = buildEvalInitPrompt(skillContent);
    expect(prompt).toContain("social-media-posting");
  });

  it("includes best practices section", () => {
    const prompt = buildEvalInitPrompt(skillContent);
    expect(prompt).toContain("Best Practices");
    expect(prompt).toContain("objectively verifiable");
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedEvals
// ---------------------------------------------------------------------------

describe("parseGeneratedEvals", () => {
  it("extracts JSON from markdown code fence", () => {
    const raw = `Here is the evals.json:

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
\`\`\`

That's the evals file.`;

    const result = parseGeneratedEvals(raw);
    expect(result.skill_name).toBe("test-skill");
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0].assertions).toHaveLength(1);
  });

  it("throws when no code block is found", () => {
    const raw = "Just some text without any JSON code block.";
    expect(() => parseGeneratedEvals(raw)).toThrow(/code block/i);
  });

  it("throws when JSON inside fence is invalid", () => {
    const raw = "```json\n{ invalid json }\n```";
    expect(() => parseGeneratedEvals(raw)).toThrow();
  });

  it("validates extracted JSON against schema", () => {
    const raw = '```json\n{ "skill_name": "test" }\n```';
    expect(() => parseGeneratedEvals(raw)).toThrow(); // missing evals array
  });
});
