import { describe, it, expect } from "vitest";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { filterAgents } from "./agent-filter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/commands",
    globalSkillsDir: "~/.claude/commands",
    isUniversal: false,
    detectInstalled: "which claude",
    parentCompany: "Anthropic",
    featureSupport: {
      slashCommands: true,
      hooks: true,
      mcp: true,
      customSystemPrompt: true,
    },
    ...overrides,
  };
}

const claudeAgent = makeAgent({ id: "claude-code", displayName: "Claude Code" });
const cursorAgent = makeAgent({ id: "cursor", displayName: "Cursor" });
const windsurf = makeAgent({ id: "windsurf", displayName: "Windsurf" });

const allAgents = [claudeAgent, cursorAgent, windsurf];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("filterAgents", () => {
  // TC-001: No filter returns all agents
  it("returns all agents when requestedIds is undefined", () => {
    const result = filterAgents(allAgents, undefined);
    expect(result).toEqual(allAgents);
  });

  // TC-002: Single filter returns only matching
  it("returns only the matching agent when filtering by single ID", () => {
    const result = filterAgents(allAgents, ["claude-code"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("claude-code");
  });

  // TC-003: Multiple filters returns all matching
  it("returns all matching agents when filtering by multiple IDs", () => {
    const result = filterAgents(allAgents, ["claude-code", "cursor"]);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(["claude-code", "cursor"]);
  });

  // TC-004: Unknown ID throws with available agents listed
  it("throws error listing available agents when ID is unknown", () => {
    expect(() => filterAgents(allAgents, ["nonexistent"])).toThrow(
      /Unknown agent\(s\): nonexistent/,
    );
    expect(() => filterAgents(allAgents, ["nonexistent"])).toThrow(
      /Available: claude-code, cursor, windsurf/,
    );
  });

  // TC-005: Mix of valid and invalid throws
  it("throws error mentioning only the invalid IDs", () => {
    expect(() =>
      filterAgents(allAgents, ["claude-code", "nonexistent"]),
    ).toThrow(/Unknown agent\(s\): nonexistent/);
  });

  // TC-006: Empty array returns all (same as undefined)
  it("returns all agents when requestedIds is an empty array", () => {
    const result = filterAgents(allAgents, []);
    expect(result).toEqual(allAgents);
  });

  // TC-007: String input is coerced to array
  it("handles single string input by coercing to array", () => {
    const result = filterAgents(allAgents, "claude-code");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("claude-code");
  });

  // TC-008: Empty string returns all agents
  it("returns all agents when requestedIds is an empty string", () => {
    const result = filterAgents(allAgents, "");
    expect(result).toEqual(allAgents);
  });
});
