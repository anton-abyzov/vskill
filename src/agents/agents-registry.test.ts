import { describe, it, expect, vi } from "vitest";
import {
  AGENTS_REGISTRY,
  TOTAL_AGENTS,
  getUniversalAgents,
  getNonUniversalAgents,
  getAgent,
  detectInstalledAgents,
  filterAgentsByFeatures,
  getAgentCreationProfile,
  NON_AGENT_CONFIG_DIRS,
} from "./agents-registry.js";

// ---------------------------------------------------------------------------
// Registry size
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY", () => {
  it("TC-044: has at least 49 entries", () => {
    expect(AGENTS_REGISTRY.length).toBeGreaterThanOrEqual(49);
  });

  it("TOTAL_AGENTS matches AGENTS_REGISTRY.length", () => {
    expect(TOTAL_AGENTS).toBe(AGENTS_REGISTRY.length);
  });
});

// ---------------------------------------------------------------------------
// Universal vs non-universal split
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — universal/non-universal split", () => {
  it("has exactly 8 universal agents", () => {
    const universal = AGENTS_REGISTRY.filter((a) => a.isUniversal);
    expect(universal).toHaveLength(8);
  });

  it("has at least 41 non-universal agents", () => {
    const nonUniversal = AGENTS_REGISTRY.filter((a) => !a.isUniversal);
    expect(nonUniversal.length).toBeGreaterThanOrEqual(41);
  });

  it("universal + non-universal equals total", () => {
    const universal = AGENTS_REGISTRY.filter((a) => a.isUniversal).length;
    const nonUniversal = AGENTS_REGISTRY.filter((a) => !a.isUniversal).length;
    expect(universal + nonUniversal).toBe(TOTAL_AGENTS);
  });
});

// ---------------------------------------------------------------------------
// No duplicate IDs
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — unique IDs", () => {
  it("has no duplicate IDs", () => {
    const ids = AGENTS_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Required fields on every agent
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — required fields", () => {
  it("every agent has all required fields", () => {
    for (const agent of AGENTS_REGISTRY) {
      expect(typeof agent.id).toBe("string");
      expect(agent.id.length).toBeGreaterThan(0);

      expect(typeof agent.displayName).toBe("string");
      expect(agent.displayName.length).toBeGreaterThan(0);

      expect(typeof agent.localSkillsDir).toBe("string");
      expect(agent.localSkillsDir.length).toBeGreaterThan(0);

      expect(typeof agent.globalSkillsDir).toBe("string");
      expect(agent.globalSkillsDir.length).toBeGreaterThan(0);

      expect(typeof agent.isUniversal).toBe("boolean");

      expect(typeof agent.detectInstalled).toBe("string");
      expect(agent.detectInstalled.length).toBeGreaterThan(0);

      expect(typeof agent.parentCompany).toBe("string");
      expect(agent.parentCompany.length).toBeGreaterThan(0);

      expect(agent.featureSupport).toBeDefined();
      expect(typeof agent.featureSupport.slashCommands).toBe("boolean");
      expect(typeof agent.featureSupport.hooks).toBe("boolean");
      expect(typeof agent.featureSupport.mcp).toBe("boolean");
      expect(typeof agent.featureSupport.customSystemPrompt).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// getUniversalAgents()
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TC-043: Claude Code uses .claude/skills
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — Claude Code path", () => {
  it("TC-043: claude-code agent uses .claude/skills as localSkillsDir", () => {
    const claudeCode = getAgent("claude-code");
    expect(claudeCode).toBeDefined();
    expect(claudeCode!.localSkillsDir).toBe(".claude/skills");
  });
});

// ---------------------------------------------------------------------------
// getUniversalAgents()
// ---------------------------------------------------------------------------
describe("getUniversalAgents", () => {
  it("returns exactly 8 agents", () => {
    expect(getUniversalAgents()).toHaveLength(8);
  });

  it("all returned agents have isUniversal === true", () => {
    for (const agent of getUniversalAgents()) {
      expect(agent.isUniversal).toBe(true);
    }
  });

  it("includes known universal agents", () => {
    const ids = getUniversalAgents().map((a) => a.id);
    expect(ids).toContain("amp");
    expect(ids).toContain("cline");
    expect(ids).toContain("codex");
    expect(ids).toContain("cursor");
    expect(ids).toContain("gemini-cli");
    expect(ids).toContain("github-copilot-ext");
    expect(ids).toContain("kimi-cli");
    expect(ids).toContain("opencode");
  });
});

// ---------------------------------------------------------------------------
// getNonUniversalAgents()
// ---------------------------------------------------------------------------
describe("getNonUniversalAgents", () => {
  it("returns at least 41 agents", () => {
    expect(getNonUniversalAgents().length).toBeGreaterThanOrEqual(41);
  });

  it("all returned agents have isUniversal === false", () => {
    for (const agent of getNonUniversalAgents()) {
      expect(agent.isUniversal).toBe(false);
    }
  });

  it("includes known non-universal agents", () => {
    const ids = getNonUniversalAgents().map((a) => a.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("replit");
  });
});

// ---------------------------------------------------------------------------
// getAgent()
// ---------------------------------------------------------------------------
describe("getAgent", () => {
  it("returns Claude Code for id 'claude-code'", () => {
    const agent = getAgent("claude-code");
    expect(agent).toBeDefined();
    expect(agent!.id).toBe("claude-code");
    expect(agent!.displayName).toBe("Claude Code");
    expect(agent!.parentCompany).toBe("Anthropic");
  });

  it("returns undefined for nonexistent id", () => {
    expect(getAgent("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getAgent("")).toBeUndefined();
  });

  it("returns correct agent for each known agent", () => {
    for (const agent of AGENTS_REGISTRY) {
      const found = getAgent(agent.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(agent.id);
      expect(found!.displayName).toBe(agent.displayName);
    }
  });
});

// ---------------------------------------------------------------------------
// detectInstalledAgents()
// ---------------------------------------------------------------------------
describe("detectInstalledAgents", () => {
  const mockExec = vi.hoisted(() =>
    vi.fn<(cmd: string) => Promise<{ stdout: string; stderr: string }>>(),
  );
  const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));

  vi.mock("node:child_process", () => ({
    exec: mockExec,
  }));

  vi.mock("node:util", () => ({
    promisify: () => mockExec,
  }));

  vi.mock("node:fs", () => ({
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  }));

  vi.mock("node:path", async () => {
    const actual = await vi.importActual<typeof import("node:path")>("node:path");
    return { ...actual };
  });

  it("returns an array", async () => {
    mockExec.mockRejectedValue(new Error("not found"));
    const result = await detectInstalledAgents();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns empty array when no agents are installed", async () => {
    mockExec.mockRejectedValue(new Error("not found"));
    const result = await detectInstalledAgents();
    expect(result).toHaveLength(0);
  });

  it("returns installed agent definitions when commands succeed", async () => {
    // Make only "which claude" succeed (claude-code's detectInstalled)
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "which claude") {
        return { stdout: "/usr/local/bin/claude", stderr: "" };
      }
      throw new Error("not found");
    });

    const result = await detectInstalledAgents();
    expect(result.map((a) => a.id)).toContain("claude-code");
    expect(result[0]).toHaveProperty("displayName");
  });

  it("returns sorted results by id", async () => {
    // Make cursor and claude succeed
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "which claude" || cmd === "which cursor") {
        return { stdout: "/usr/local/bin/tool", stderr: "" };
      }
      throw new Error("not found");
    });

    const result = await detectInstalledAgents();
    const ids = result.map((a) => a.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("returns all locally-installable agents when all commands succeed", async () => {
    // Make all commands succeed
    mockExec.mockResolvedValue({ stdout: "/usr/local/bin/tool", stderr: "" });

    const result = await detectInstalledAgents();
    // F-008: isRemoteOnly entries are short-circuited and never returned.
    const remoteOnlyCount = AGENTS_REGISTRY.filter((a) => a.isRemoteOnly === true).length;
    expect(result.length).toBe(TOTAL_AGENTS - remoteOnlyCount);
  });

  it("does NOT detect agent when only parent config dir exists (no false positives)", async () => {
    // No CLI binary found
    mockExec.mockRejectedValue(new Error("not found"));
    // Parent dir ~/.cursor exists, but ~/.cursor/skills does NOT
    const home = process.env.HOME || process.env.USERPROFILE || "";
    mockExistsSync.mockImplementation((p: string) => {
      if (p === `${home}/.cursor`) return true; // parent config dir
      return false; // skills dir does not exist
    });

    const result = await detectInstalledAgents();
    const ids = result.map((a) => a.id);
    expect(ids).not.toContain("cursor");
  });

  it("detects agent when exact global skills dir exists", async () => {
    // No CLI binary found
    mockExec.mockRejectedValue(new Error("not found"));
    const home = process.env.HOME || process.env.USERPROFILE || "";
    mockExistsSync.mockImplementation((p: string) => {
      if (p === `${home}/.cursor/skills`) return true; // exact skills dir
      return false;
    });

    const result = await detectInstalledAgents();
    const ids = result.map((a) => a.id);
    expect(ids).toContain("cursor");
  });

  // 0694 review-iter3 F-008: isRemoteOnly agents (devin, bolt-new, v0, replit)
  // must never appear in detectInstalledAgents() — even if their globalSkillsDir
  // exists. Replit in particular shares `~/.config/agents/skills` with kimi-cli
  // and amp, so the Tier 2 fallback would otherwise false-positive whenever a
  // universal CLI populated that directory.
  it("F-008: detectInstalledAgents() skips isRemoteOnly agents even if their config dirs exist", async () => {
    mockExec.mockRejectedValue(new Error("not found")); // no CLI binaries
    mockExistsSync.mockReturnValue(true); // every globalSkillsDir reports present
    const result = await detectInstalledAgents();
    const ids = result.map((a) => a.id);
    expect(ids).not.toContain("replit");
    expect(ids).not.toContain("devin");
    expect(ids).not.toContain("bolt-new");
    expect(ids).not.toContain("v0");
  });

  // 0694 T-013: detection picks up the new CLI binaries.
  it("0694 T-013: detects copilot-cli + warp + amazon-q-cli when their binaries are on PATH", async () => {
    mockExistsSync.mockReturnValue(false);
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "which copilot" || cmd === "which warp" || cmd === "which q") {
        return { stdout: "/usr/local/bin/tool", stderr: "" };
      }
      throw new Error("not found");
    });
    const result = await detectInstalledAgents();
    const ids = result.map((a) => a.id);
    expect(ids).toContain("copilot-cli");
    expect(ids).toContain("warp");
    expect(ids).toContain("amazon-q-cli");
  });
});

// ---------------------------------------------------------------------------
// TC-013: Claude Code agent has pluginCacheDir
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — pluginCacheDir", () => {
  it("TC-013: claude-code agent has pluginCacheDir", () => {
    const claudeCode = getAgent("claude-code");
    expect(claudeCode).toBeDefined();
    expect(claudeCode!.pluginCacheDir).toBe("~/.claude/plugins/cache");
  });
});

// ---------------------------------------------------------------------------
// filterAgentsByFeatures()
// ---------------------------------------------------------------------------
describe("filterAgentsByFeatures", () => {
  it("returns agents matching a single feature flag", () => {
    const result = filterAgentsByFeatures({ slashCommands: true });
    expect(result.length).toBeGreaterThan(0);
    for (const agent of result) {
      expect(agent.featureSupport.slashCommands).toBe(true);
    }
  });

  it("returns agents matching multiple feature flags (AND logic)", () => {
    const result = filterAgentsByFeatures({ slashCommands: true, hooks: true });
    expect(result.length).toBeGreaterThan(0);
    for (const agent of result) {
      expect(agent.featureSupport.slashCommands).toBe(true);
      expect(agent.featureSupport.hooks).toBe(true);
    }
    // claude-code is the only agent with hooks: true
    expect(result.map((a) => a.id)).toContain("claude-code");
  });

  it("returns empty array when no agents match", () => {
    // No agent has hooks: true AND slashCommands: false simultaneously
    // Actually, let's test with an impossible combo
    const withHooks = filterAgentsByFeatures({ hooks: true });
    // All agents with hooks also have slashCommands, so filtering hooks:true + customSystemPrompt:false should be empty
    const result = filterAgentsByFeatures({ hooks: true, customSystemPrompt: false });
    expect(result).toHaveLength(0);
  });

  it("returns all agents when no features specified", () => {
    const result = filterAgentsByFeatures({});
    expect(result).toHaveLength(AGENTS_REGISTRY.length);
  });

  it("filters on mcp feature correctly", () => {
    const result = filterAgentsByFeatures({ mcp: true });
    expect(result.length).toBeGreaterThan(0);
    for (const agent of result) {
      expect(agent.featureSupport.mcp).toBe(true);
    }
    expect(result.map((a) => a.id)).toContain("cursor");
    expect(result.map((a) => a.id)).toContain("claude-code");
  });
});

// ---------------------------------------------------------------------------
// getAgentCreationProfile()
// ---------------------------------------------------------------------------
describe("getAgentCreationProfile", () => {
  it("returns a profile for a known non-Claude agent (cursor)", () => {
    const profile = getAgentCreationProfile("cursor");
    expect(profile).toBeDefined();
    expect(profile!.agent.id).toBe("cursor");
    expect(profile!.featureSupport).toEqual(getAgent("cursor")!.featureSupport);
    expect(profile!.stripFields.length).toBeGreaterThan(0);
    expect(profile!.addGuidance.length).toBeGreaterThan(0);
  });

  it("returns a profile for claude-code with empty stripFields", () => {
    const profile = getAgentCreationProfile("claude-code");
    expect(profile).toBeDefined();
    expect(profile!.agent.id).toBe("claude-code");
    expect(profile!.stripFields).toHaveLength(0);
    expect(profile!.addGuidance).toHaveLength(0);
    expect(profile!.featureSupport.hooks).toBe(true);
    expect(profile!.featureSupport.slashCommands).toBe(true);
  });

  it("returns undefined for unknown agent", () => {
    expect(getAgentCreationProfile("unknown-agent")).toBeUndefined();
  });

  it("returns stripFields that include Claude-specific fields for agents without hooks", () => {
    const profile = getAgentCreationProfile("codex");
    expect(profile).toBeDefined();
    // Codex has no slashCommands, no hooks, no mcp
    expect(profile!.stripFields).toContain("allowed-tools");
    expect(profile!.stripFields).toContain("user-invocable");
    expect(profile!.stripFields).toContain("model");
    expect(profile!.stripFields).toContain("argument-hint");
    expect(profile!.stripFields).toContain("context");
  });

  it("includes guidance about missing features for limited agents", () => {
    const profile = getAgentCreationProfile("codex");
    expect(profile).toBeDefined();
    // Codex has slashCommands: false, hooks: false, mcp: false
    const guidance = profile!.addGuidance.join(" ");
    expect(guidance).toMatch(/slash command/i);
    expect(guidance).toMatch(/hook/i);
    expect(guidance).toMatch(/MCP/i);
  });

  it("does not include guidance about features the agent supports", () => {
    // Cursor supports slashCommands, mcp, customSystemPrompt but not hooks
    const profile = getAgentCreationProfile("cursor");
    expect(profile).toBeDefined();
    const guidance = profile!.addGuidance.join(" ");
    expect(guidance).toMatch(/hook/i); // cursor lacks hooks
    expect(guidance).not.toMatch(/slash command/i); // cursor has slashCommands
  });
});

// ---------------------------------------------------------------------------
// 0694: isRemoteOnly flag (US-004) — gate web-only agents from local install
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — isRemoteOnly (0694 AC-US4-01..03)", () => {
  it("AC-US4-01: AgentDefinition supports an optional isRemoteOnly boolean", () => {
    // Type-level check: TS compilation is the real assertion. At runtime,
    // verify the four web-only entries each set the flag explicitly.
    const remoteIds = AGENTS_REGISTRY.filter((a) => a.isRemoteOnly === true).map(
      (a) => a.id,
    );
    expect(remoteIds.length).toBeGreaterThan(0);
  });

  it("AC-US4-02: devin/bolt-new/v0/replit are flagged isRemoteOnly: true", () => {
    const remoteIds = AGENTS_REGISTRY.filter((a) => a.isRemoteOnly === true)
      .map((a) => a.id)
      .sort();
    expect(remoteIds).toEqual(["bolt-new", "devin", "replit", "v0"]);
  });

  it("AC-US4-03: getInstallableAgents() excludes isRemoteOnly entries", async () => {
    const { getInstallableAgents } = await import("./agents-registry.js");
    const installable = getInstallableAgents();
    expect(installable.length).toBe(AGENTS_REGISTRY.length - 4);
    for (const agent of installable) {
      expect(agent.isRemoteOnly).not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 0694: LEGACY_AGENT_IDS alias map (US-001) — backward compat for renames
// ---------------------------------------------------------------------------
describe("LEGACY_AGENT_IDS + getAgent alias resolution (0694 AC-US1-04)", () => {
  it("LEGACY_AGENT_IDS maps github-copilot → github-copilot-ext", async () => {
    const { LEGACY_AGENT_IDS } = await import("./agents-registry.js");
    expect(LEGACY_AGENT_IDS["github-copilot"]).toBe("github-copilot-ext");
  });

  it("getAgent('github-copilot') resolves to the renamed entry", () => {
    const legacy = getAgent("github-copilot");
    const current = getAgent("github-copilot-ext");
    expect(legacy).toBeDefined();
    expect(current).toBeDefined();
    expect(legacy).toBe(current);
  });
});

// ---------------------------------------------------------------------------
// 0694: New CLI adapters (US-001/US-002/US-003/US-005)
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — new CLI adapters (0694)", () => {
  it("AC-US1-01: copilot-cli entry has the GitHub Copilot CLI shape", () => {
    const a = getAgent("copilot-cli");
    expect(a).toBeDefined();
    expect(a!.displayName).toBe("GitHub Copilot CLI");
    expect(a!.localSkillsDir).toBe(".copilot/skills");
    expect(a!.globalSkillsDir).toBe("~/.copilot/skills");
    expect(a!.detectInstalled).toBe("which copilot");
    expect(a!.parentCompany).toBe("GitHub (Microsoft)");
  });

  it("AC-US1-02: github-copilot-ext is the renamed VS Code extension entry", () => {
    const a = getAgent("github-copilot-ext");
    expect(a).toBeDefined();
    expect(a!.displayName).toBe("GitHub Copilot (VS Code)");
    expect(a!.localSkillsDir).toBe(".github/copilot/skills");
  });

  it("AC-US2-01: warp entry exists with correct shape", () => {
    const a = getAgent("warp");
    expect(a).toBeDefined();
    expect(a!.displayName).toBe("Warp");
    expect(a!.parentCompany).toBe("Warp");
    expect(a!.detectInstalled).toBe("which warp");
    expect(a!.localSkillsDir.length).toBeGreaterThan(0);
    expect(a!.globalSkillsDir.length).toBeGreaterThan(0);
  });

  it("AC-US3-01: amazon-q-cli entry exists with correct shape", () => {
    const a = getAgent("amazon-q-cli");
    expect(a).toBeDefined();
    expect(a!.displayName).toBe("Amazon Q CLI");
    expect(a!.parentCompany).toBe("AWS");
    expect(a!.detectInstalled).toBe("which q");
  });

  it("AC-US5-01: zed entry exists with .zed/skills local dir", () => {
    const a = getAgent("zed");
    expect(a).toBeDefined();
    expect(a!.displayName).toBe("Zed");
    expect(a!.localSkillsDir).toBe(".zed/skills");
    expect(a!.detectInstalled).toBe("which zed");
  });
});

// ---------------------------------------------------------------------------
// 0694 T-012: Integration round-trip — load → resolve install path for the 4
// new agents (copilot-cli, warp, amazon-q-cli, zed). Asserts each resolves
// to an absolute, non-tilde path under the agent's expected globalSkillsDir.
// ---------------------------------------------------------------------------
describe("0694 T-012: install-path round-trip for new agents", () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  function resolveTilde(p: string): string {
    return p.startsWith("~/") ? home + p.slice(1) : p;
  }

  it.each([
    ["copilot-cli", `${home}/.copilot/skills`],
    ["warp", `${home}/.warp/skills`],
    ["amazon-q-cli", `${home}/.aws/amazonq/skills`],
    ["zed", `${home}/.config/zed/skills`],
  ])("agent %s resolves globalSkillsDir to %s", (id, expected) => {
    const agent = getAgent(id);
    expect(agent).toBeDefined();
    const resolved = resolveTilde(agent!.globalSkillsDir);
    expect(resolved).toBe(expected);
    expect(resolved.startsWith("/") || /^[A-Za-z]:/.test(resolved)).toBe(true);
  });

  it("each new agent's local + global dirs end with 'skills'", () => {
    for (const id of ["copilot-cli", "warp", "amazon-q-cli", "zed"]) {
      const a = getAgent(id);
      expect(a).toBeDefined();
      expect(a!.localSkillsDir.endsWith("/skills")).toBe(true);
      expect(a!.globalSkillsDir.endsWith("/skills")).toBe(true);
    }
  });
});


// ---------------------------------------------------------------------------
// 0693: NON_AGENT_CONFIG_DIRS — non-agent config dirs co-located with registry
// ---------------------------------------------------------------------------
describe("NON_AGENT_CONFIG_DIRS (0693 AC-US2-01)", () => {
  it("exports the 8 expected non-agent config dirs", () => {
    expect(NON_AGENT_CONFIG_DIRS).toEqual([
      ".specweave",
      ".vscode",
      ".idea",
      ".zed",
      ".devcontainer",
      ".github",
      ".agents",
      ".agent",
    ]);
  });

  it("is frozen (readonly)", () => {
    expect(Object.isFrozen(NON_AGENT_CONFIG_DIRS)).toBe(true);
  });

  it("includes editor/IDE/CI dirs that are not agent install targets", () => {
    expect(NON_AGENT_CONFIG_DIRS).toContain(".vscode");
    expect(NON_AGENT_CONFIG_DIRS).toContain(".idea");
    expect(NON_AGENT_CONFIG_DIRS).toContain(".zed");
    expect(NON_AGENT_CONFIG_DIRS).toContain(".devcontainer");
    expect(NON_AGENT_CONFIG_DIRS).toContain(".specweave");
  });
});

// ---------------------------------------------------------------------------
// 0694 follow-ups (F-003, F-005)
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY \u2014 0694 follow-ups", () => {
  it("F-003: kiro-cli and amazon-q-cli share parentCompany 'AWS'", () => {
    expect(getAgent("kiro-cli")?.parentCompany).toBe("AWS");
    expect(getAgent("amazon-q-cli")?.parentCompany).toBe("AWS");
  });

  it("F-005: github-copilot-ext detection chains binary check + extension dir glob", () => {
    const detect = getAgent("github-copilot-ext")?.detectInstalled;
    expect(detect).toContain("which code");
    expect(detect).toContain("~/.vscode/extensions/github.copilot-");
  });
});
