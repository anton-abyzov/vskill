import { describe, it, expect } from "vitest";
import {
  buildEvalInitPrompt,
  buildEvalSystemPrompt,
  buildBaselineSystemPrompt,
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

  it("includes MCP context for Slack skill", () => {
    const slackSkill = "Use slack_send_message to post messages to Slack channels.";
    const prompt = buildEvalInitPrompt(slackSkill);
    expect(prompt).toContain("MCP Simulation Context");
    expect(prompt).toContain("Slack");
  });

  it("is unchanged for non-MCP skill", () => {
    const plainSkill = "# My Skill\nThis skill does text processing.";
    const prompt = buildEvalInitPrompt(plainSkill);
    expect(prompt).not.toContain("MCP Simulation Context");
  });

  it("lists all detected MCP servers", () => {
    const multiSkill = "Use slack_send_message for chat and github_create_pr for PRs.";
    const prompt = buildEvalInitPrompt(multiSkill);
    expect(prompt).toContain("Slack");
    expect(prompt).toContain("GitHub");
    expect(prompt).toContain("MCP Simulation Context");
  });
});

// ---------------------------------------------------------------------------
// buildEvalSystemPrompt (MCP-aware)
// ---------------------------------------------------------------------------

describe("buildEvalSystemPrompt", () => {
  it("returns standard prompt for non-MCP skills", () => {
    const result = buildEvalSystemPrompt("# My Skill\nDoes text processing.");
    expect(result).toContain("You are an AI assistant enhanced with the following skill");
    expect(result).toContain("# My Skill");
    expect(result).not.toContain("Evaluation Mode");
  });

  it("returns simulation prompt for Slack MCP skill", () => {
    const slackSkill = "Use slack_send_message and slack_read_channel to interact with Slack.";
    const result = buildEvalSystemPrompt(slackSkill);
    expect(result).toContain("Evaluation Mode");
    expect(result).toContain("slack_send_message");
    expect(result).toContain("slack_read_channel");
    expect(result).toContain("Slack");
    expect(result).toContain("Do NOT");
  });

  it("returns simulation prompt for GitHub MCP skill", () => {
    const githubSkill = "Use github_create_pr to create pull requests.";
    const result = buildEvalSystemPrompt(githubSkill);
    expect(result).toContain("Evaluation Mode");
    expect(result).toContain("github_create_pr");
    expect(result).toContain("GitHub");
  });

  it("lists multiple MCP servers when skill uses several", () => {
    const multiSkill = "Use slack_send_message for chat and github_create_pr for PRs and drive_list_files for docs.";
    const result = buildEvalSystemPrompt(multiSkill);
    expect(result).toContain("Slack");
    expect(result).toContain("GitHub");
    expect(result).toContain("Google Workspace");
  });

  it("returns baseline prompt for empty content", () => {
    expect(buildEvalSystemPrompt("")).toBe("You are a helpful AI assistant.");
  });

  it("includes simulation instructions that prevent tool-unavailable responses", () => {
    const skill = "Use slack_send_message to send messages.";
    const result = buildEvalSystemPrompt(skill);
    expect(result).toContain("Do NOT");
    expect(result).toContain("tools are unavailable");
    expect(result).toContain("Walk through each tool call step by step");
  });
});

// ---------------------------------------------------------------------------
// buildBaselineSystemPrompt
// ---------------------------------------------------------------------------

describe("buildBaselineSystemPrompt", () => {
  it("returns baseline prompt", () => {
    expect(buildBaselineSystemPrompt()).toBe("You are a helpful AI assistant.");
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
