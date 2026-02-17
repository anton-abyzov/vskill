import { describe, it, expect, vi } from "vitest";
import {
  AGENTS_REGISTRY,
  TOTAL_AGENTS,
  getUniversalAgents,
  getNonUniversalAgents,
  getAgent,
  detectInstalledAgents,
} from "./agents-registry.js";

// ---------------------------------------------------------------------------
// Registry size
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY", () => {
  it("has exactly 39 entries", () => {
    expect(AGENTS_REGISTRY).toHaveLength(39);
  });

  it("TOTAL_AGENTS equals 39", () => {
    expect(TOTAL_AGENTS).toBe(39);
  });

  it("TOTAL_AGENTS matches AGENTS_REGISTRY.length", () => {
    expect(TOTAL_AGENTS).toBe(AGENTS_REGISTRY.length);
  });
});

// ---------------------------------------------------------------------------
// Universal vs non-universal split
// ---------------------------------------------------------------------------
describe("AGENTS_REGISTRY — universal/non-universal split", () => {
  it("has exactly 7 universal agents", () => {
    const universal = AGENTS_REGISTRY.filter((a) => a.isUniversal);
    expect(universal).toHaveLength(7);
  });

  it("has exactly 32 non-universal agents", () => {
    const nonUniversal = AGENTS_REGISTRY.filter((a) => !a.isUniversal);
    expect(nonUniversal).toHaveLength(32);
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
describe("getUniversalAgents", () => {
  it("returns exactly 7 agents", () => {
    expect(getUniversalAgents()).toHaveLength(7);
  });

  it("all returned agents have isUniversal === true", () => {
    for (const agent of getUniversalAgents()) {
      expect(agent.isUniversal).toBe(true);
    }
  });

  it("includes known universal agents", () => {
    const ids = getUniversalAgents().map((a) => a.id);
    expect(ids).toContain("amp");
    expect(ids).toContain("codex");
    expect(ids).toContain("gemini-cli");
    expect(ids).toContain("github-copilot");
    expect(ids).toContain("kimi-cli");
    expect(ids).toContain("opencode");
    expect(ids).toContain("replit");
  });
});

// ---------------------------------------------------------------------------
// getNonUniversalAgents()
// ---------------------------------------------------------------------------
describe("getNonUniversalAgents", () => {
  it("returns exactly 32 agents", () => {
    expect(getNonUniversalAgents()).toHaveLength(32);
  });

  it("all returned agents have isUniversal === false", () => {
    for (const agent of getNonUniversalAgents()) {
      expect(agent.isUniversal).toBe(false);
    }
  });

  it("includes known non-universal agents", () => {
    const ids = getNonUniversalAgents().map((a) => a.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("cline");
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

  vi.mock("node:child_process", () => ({
    exec: mockExec,
  }));

  vi.mock("node:util", () => ({
    promisify: () => mockExec,
  }));

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

  it("returns installed agent IDs when commands succeed", async () => {
    // Make only "which claude" succeed (claude-code's detectInstalled)
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "which claude") {
        return { stdout: "/usr/local/bin/claude", stderr: "" };
      }
      throw new Error("not found");
    });

    const result = await detectInstalledAgents();
    expect(result).toContain("claude-code");
  });

  it("returns sorted results", async () => {
    // Make cursor and claude succeed
    mockExec.mockImplementation(async (cmd: string) => {
      if (cmd === "which claude" || cmd === "which cursor") {
        return { stdout: "/usr/local/bin/tool", stderr: "" };
      }
      throw new Error("not found");
    });

    const result = await detectInstalledAgents();
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  it("returns multiple installed agents when many commands succeed", async () => {
    // Make all commands succeed
    mockExec.mockResolvedValue({ stdout: "/usr/local/bin/tool", stderr: "" });

    const result = await detectInstalledAgents();
    expect(result.length).toBe(TOTAL_AGENTS);
  });
});
