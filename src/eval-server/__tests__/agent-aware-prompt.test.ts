import { describe, it, expect } from "vitest";
import { buildAgentAwareSystemPrompt } from "../skill-create-routes.js";

const FAKE_BASE_PROMPT = "You are an expert AI skill engineer.";

// ---------------------------------------------------------------------------
// buildAgentAwareSystemPrompt()
// ---------------------------------------------------------------------------

describe("buildAgentAwareSystemPrompt", () => {
  it("returns base prompt unchanged when no targetAgents", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, undefined);
    expect(result).toBe(FAKE_BASE_PROMPT);
  });

  it("returns base prompt unchanged when targetAgents is empty array", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, []);
    expect(result).toBe(FAKE_BASE_PROMPT);
  });

  it("returns base prompt unchanged when targetAgents is only claude-code", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["claude-code"]);
    expect(result).toBe(FAKE_BASE_PROMPT);
  });

  it("appends agent constraints section for non-Claude agent", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["cursor"]);
    expect(result).toContain(FAKE_BASE_PROMPT);
    expect(result).toContain("## Target Agent Constraints");
    expect(result).toContain("Cursor");
  });

  it("includes 'Do NOT include hook examples' for cursor (no hooks support)", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["cursor"]);
    expect(result).toMatch(/hook/i);
  });

  it("does NOT include slash command warning for cursor (has slashCommands)", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["cursor"]);
    expect(result).not.toMatch(/Do NOT reference slash commands/);
  });

  it("includes slash command and hook warnings for codex (no slashCommands, no hooks)", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["codex"]);
    expect(result).toMatch(/Do NOT reference slash commands/);
    expect(result).toMatch(/hook/i);
    expect(result).toMatch(/MCP/i);
  });

  it("merges constraints from multiple agents", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["cursor", "codex"]);
    expect(result).toContain("## Target Agent Constraints");
    expect(result).toContain("Cursor");
    expect(result).toContain("Codex CLI");
  });

  it("does NOT append constraints when mixed with claude-code and only claude-code features missing", () => {
    // claude-code + cursor: prompt should include constraints for cursor's missing features
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["claude-code", "cursor"]);
    expect(result).toContain("## Target Agent Constraints");
    // Constraints should reflect what cursor lacks (hooks)
    expect(result).toMatch(/hook/i);
  });

  it("ignores unknown agent IDs gracefully", () => {
    const result = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["unknown-agent"]);
    // Unknown agents should be skipped, prompt unchanged
    expect(result).toBe(FAKE_BASE_PROMPT);
  });

  it("derives constraints from getAgentCreationProfile, not hardcoded agent names", () => {
    // Test with different agents that have same feature gaps
    const codexResult = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["codex"]);
    const replitResult = buildAgentAwareSystemPrompt(FAKE_BASE_PROMPT, ["replit"]);
    // Both lack slashCommands, hooks, mcp — should have same constraint types
    expect(codexResult).toMatch(/slash commands/i);
    expect(replitResult).toMatch(/slash commands/i);
    expect(codexResult).toMatch(/hook/i);
    expect(replitResult).toMatch(/hook/i);
  });
});
