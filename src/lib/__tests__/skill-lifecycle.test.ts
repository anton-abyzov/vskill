// ---------------------------------------------------------------------------
// Tests for src/lib/skill-lifecycle.ts -- pure helpers for the
// install / enable / disable lifecycle (T-001).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  resolvePluginId,
  classifyAgentSurface,
  buildPerAgentReport,
  type LifecycleAction,
  type AgentSurfaceClass,
} from "../skill-lifecycle.js";
import type { SkillLockEntry } from "../../lockfile/types.js";
import type { AgentDefinition } from "../../agents/agents-registry.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(overrides: Partial<SkillLockEntry> = {}): SkillLockEntry {
  return {
    version: "1.0.0",
    sha: "abc",
    tier: "VERIFIED",
    installedAt: "2026-04-25T00:00:00.000Z",
    source: "marketplace:foo/bar#baz",
    ...overrides,
  };
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/skills",
    globalSkillsDir: "~/.claude/skills",
    isUniversal: false,
    detectInstalled: () => Promise.resolve(true),
    parentCompany: "Anthropic",
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolvePluginId
// ---------------------------------------------------------------------------

describe("resolvePluginId", () => {
  it("returns <name>@<marketplace> when marketplace is set", () => {
    expect(resolvePluginId("foo", entry({ marketplace: "specweave" }))).toBe(
      "foo@specweave",
    );
  });

  it("returns null when marketplace is missing (auto-discovered)", () => {
    expect(resolvePluginId("foo", entry({ marketplace: undefined }))).toBeNull();
  });

  it("returns null when marketplace is empty string", () => {
    expect(resolvePluginId("foo", entry({ marketplace: "" }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyAgentSurface
// ---------------------------------------------------------------------------

describe("classifyAgentSurface", () => {
  it("classifies claude-code as claude-code-style (uses enabledPlugins)", () => {
    expect(classifyAgentSurface(agent({ id: "claude-code" }))).toBe(
      "claude-code-style",
    );
  });

  it("classifies cursor as auto-discover", () => {
    expect(classifyAgentSurface(agent({ id: "cursor" }))).toBe("auto-discover");
  });

  it("classifies codex as auto-discover", () => {
    expect(classifyAgentSurface(agent({ id: "codex" }))).toBe("auto-discover");
  });

  it("classifies cline as auto-discover", () => {
    expect(classifyAgentSurface(agent({ id: "cline" }))).toBe("auto-discover");
  });

  it("classifies any non-claude agent as auto-discover (default)", () => {
    expect(classifyAgentSurface(agent({ id: "windsurf" }))).toBe(
      "auto-discover",
    );
  });
});

// ---------------------------------------------------------------------------
// buildPerAgentReport
// ---------------------------------------------------------------------------

describe("buildPerAgentReport", () => {
  it("emits one entry per agent with classification-appropriate text on enable", () => {
    const agents = [
      agent({ id: "claude-code", displayName: "Claude Code" }),
      agent({ id: "cursor", displayName: "Cursor" }),
    ];
    const report = buildPerAgentReport({
      skill: "foo",
      scope: "user",
      action: "enabled",
      agents,
    });
    expect(report).toHaveLength(2);

    const cc = report.find((r) => r.id === "claude-code")!;
    expect(cc.surface).toBe("claude-code-style");
    expect(cc.line).toContain("Claude Code");
    expect(cc.line).toContain("user");
    expect(cc.line).toMatch(/enabled/i);

    const cursor = report.find((r) => r.id === "cursor")!;
    expect(cursor.surface).toBe("auto-discover");
    expect(cursor.line).toContain("Cursor");
    expect(cursor.line).toMatch(/auto-discover/i);
  });

  it("emits already-enabled wording on already-enabled action", () => {
    const agents = [agent({ id: "claude-code", displayName: "Claude Code" })];
    const report = buildPerAgentReport({
      skill: "foo",
      scope: "user",
      action: "already-enabled",
      agents,
    });
    expect(report[0].line).toMatch(/already enabled/i);
  });

  it("emits disabled wording on disabled action", () => {
    const agents = [agent({ id: "claude-code", displayName: "Claude Code" })];
    const report = buildPerAgentReport({
      skill: "foo",
      scope: "project",
      action: "disabled",
      agents,
    });
    expect(report[0].line).toMatch(/disabled/i);
  });

  it("emits not-applicable for non-claude agents on enable/disable actions", () => {
    const agents: AgentDefinition[] = [
      agent({ id: "cursor", displayName: "Cursor" }),
    ];
    const report = buildPerAgentReport({
      skill: "foo",
      scope: "user",
      action: "enabled",
      agents,
    });
    expect(report[0].line).toMatch(/auto-discover/i);
  });

  it("returns an empty array when given no agents", () => {
    const report = buildPerAgentReport({
      skill: "foo",
      scope: "user",
      action: "enabled",
      agents: [],
    });
    expect(report).toEqual([]);
  });

  it("typecheck: AgentSurfaceClass and LifecycleAction are exported", () => {
    const surf: AgentSurfaceClass = "claude-code-style";
    const act: LifecycleAction = "enabled";
    expect(surf).toBe("claude-code-style");
    expect(act).toBe("enabled");
  });
});
