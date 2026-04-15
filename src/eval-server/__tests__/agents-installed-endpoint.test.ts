import { describe, it, expect, vi, beforeEach } from "vitest";
import { AGENTS_REGISTRY, TOTAL_AGENTS } from "../../agents/agents-registry.js";
import type { AgentDefinition } from "../../agents/agents-registry.js";
import { buildInstalledAgentsResponse } from "../api-routes.js";

// ---------------------------------------------------------------------------
// buildInstalledAgentsResponse()
// ---------------------------------------------------------------------------

describe("buildInstalledAgentsResponse", () => {
  it("returns all 49 agents in the response", () => {
    const result = buildInstalledAgentsResponse([]);
    expect(result.agents).toHaveLength(TOTAL_AGENTS);
  });

  it("each agent has required fields", () => {
    const result = buildInstalledAgentsResponse([]);
    for (const agent of result.agents) {
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("displayName");
      expect(agent).toHaveProperty("featureSupport");
      expect(agent).toHaveProperty("isUniversal");
      expect(typeof agent.installed).toBe("boolean");
    }
  });

  it("marks detected agents as installed: true", () => {
    const claudeCode = AGENTS_REGISTRY.find((a) => a.id === "claude-code")!;
    const cursor = AGENTS_REGISTRY.find((a) => a.id === "cursor")!;
    const result = buildInstalledAgentsResponse([claudeCode, cursor]);

    const claudeEntry = result.agents.find((a) => a.id === "claude-code");
    expect(claudeEntry?.installed).toBe(true);

    const cursorEntry = result.agents.find((a) => a.id === "cursor");
    expect(cursorEntry?.installed).toBe(true);
  });

  it("marks non-detected agents as installed: false", () => {
    const result = buildInstalledAgentsResponse([]);
    const codexEntry = result.agents.find((a) => a.id === "codex");
    expect(codexEntry?.installed).toBe(false);
  });

  it("agents not in detected list have installed: false (present, not omitted)", () => {
    const claudeCode = AGENTS_REGISTRY.find((a) => a.id === "claude-code")!;
    const result = buildInstalledAgentsResponse([claudeCode]);

    // All agents present
    expect(result.agents).toHaveLength(TOTAL_AGENTS);

    // Only claude-code installed
    const installedCount = result.agents.filter((a) => a.installed).length;
    expect(installedCount).toBe(1);
  });

  it("has a suggested string field", () => {
    const result = buildInstalledAgentsResponse([]);
    expect(typeof result.suggested).toBe("string");
  });

  it("suggests claude-code when it is installed", () => {
    const claudeCode = AGENTS_REGISTRY.find((a) => a.id === "claude-code")!;
    const result = buildInstalledAgentsResponse([claudeCode]);
    expect(result.suggested).toBe("claude-code");
  });

  it("suggests first installed agent alphabetically when claude-code is not installed", () => {
    const cursor = AGENTS_REGISTRY.find((a) => a.id === "cursor")!;
    const result = buildInstalledAgentsResponse([cursor]);
    expect(result.suggested).toBe("cursor");
  });

  it("suggests claude-code as default when nothing is installed", () => {
    const result = buildInstalledAgentsResponse([]);
    expect(result.suggested).toBe("claude-code");
  });
});
