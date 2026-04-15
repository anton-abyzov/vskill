import { describe, it, expect } from "vitest";
import { filterAgentsByTargetAgents } from "./canonical.js";
import type { AgentDefinition } from "../agents/agents-registry.js";

// ---------------------------------------------------------------------------
// Mock agents for testing
// ---------------------------------------------------------------------------

const mockAgents: AgentDefinition[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/skills",
    globalSkillsDir: "~/.claude/skills",
    isUniversal: false,
    detectInstalled: "which claude",
    parentCompany: "Anthropic",
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    localSkillsDir: ".cursor/skills",
    globalSkillsDir: "~/.cursor/skills",
    isUniversal: true,
    detectInstalled: "which cursor",
    parentCompany: "Anysphere",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: "cline",
    displayName: "Cline",
    localSkillsDir: ".cline/skills",
    globalSkillsDir: "~/.cline/skills",
    isUniversal: true,
    detectInstalled: "which cline",
    parentCompany: "Cline",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
];

// ---------------------------------------------------------------------------
// filterAgentsByTargetAgents()
// ---------------------------------------------------------------------------

describe("filterAgentsByTargetAgents", () => {
  it("returns all agents when targetAgents is undefined", () => {
    const result = filterAgentsByTargetAgents(mockAgents, undefined);
    expect(result).toHaveLength(3);
    expect(result).toEqual(mockAgents);
  });

  it("returns all agents when targetAgents is empty array", () => {
    const result = filterAgentsByTargetAgents(mockAgents, []);
    expect(result).toHaveLength(3);
  });

  it("filters to only matching agents when targetAgents is specified", () => {
    const result = filterAgentsByTargetAgents(mockAgents, ["claude-code", "cursor"]);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(["claude-code", "cursor"]);
  });

  it("ignores unknown agent IDs in targetAgents", () => {
    const result = filterAgentsByTargetAgents(mockAgents, ["claude-code", "unknown-agent"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("claude-code");
  });

  it("returns empty array when no targetAgents match detected agents", () => {
    const result = filterAgentsByTargetAgents(mockAgents, ["codex", "replit"]);
    expect(result).toHaveLength(0);
  });
});
