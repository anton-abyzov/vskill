import { describe, it, expect } from "vitest";
import { allLocalSkillsDirs, buildAgentsManifest } from "./generate-agents-json.js";
import { AGENTS_REGISTRY, NON_AGENT_CONFIG_DIRS } from "../src/agents/agents-registry.js";

// 0693 AC-US3-01: build script emits agents.json with stable shape.

describe("buildAgentsManifest (0693 AC-US3-01)", () => {
  it("returns the expected shape", () => {
    const manifest = buildAgentsManifest();
    expect(manifest).toMatchObject({
      version: 1,
      agentPrefixes: expect.any(Array),
      agentPathPrefixes: expect.any(Array),
      nonAgentConfigDirs: expect.any(Array),
    });
    expect(typeof manifest.generatedAt).toBe("string");
    expect(() => new Date(manifest.generatedAt)).not.toThrow();
  });

  it("agentPathPrefixes are trailing-slash dirs derived from localSkillsDir", () => {
    const manifest = buildAgentsManifest();
    for (const p of manifest.agentPathPrefixes) {
      expect(p.endsWith("/")).toBe(true);
      expect(p.startsWith(".")).toBe(true);
    }
  });

  it("agentPathPrefixes preserves multi-segment paths like .github/copilot/", () => {
    const manifest = buildAgentsManifest();
    expect(manifest.agentPathPrefixes).toContain(".github/copilot/");
  });

  it("agentPrefixes is the deduped union of every AGENTS_REGISTRY first-segment", () => {
    const manifest = buildAgentsManifest();
    const expected = new Set<string>();
    for (const dir of allLocalSkillsDirs()) {
      const first = dir.split("/")[0];
      if (first) expected.add(first);
    }
    expect(new Set(manifest.agentPrefixes)).toEqual(expected);
    for (const a of AGENTS_REGISTRY) {
      expect(manifest.agentPrefixes).toContain(a.localSkillsDir.split("/")[0]);
    }
  });

  it("agentPrefixes count matches deduped count from registry", () => {
    const manifest = buildAgentsManifest();
    const deduped = new Set(
      allLocalSkillsDirs().map((d) => d.split("/")[0]).filter(Boolean),
    );
    expect(manifest.agentPrefixes).toHaveLength(deduped.size);
  });

  it("keeps legacy dirs and does not widen shared config dirs (0894)", () => {
    const manifest = buildAgentsManifest();
    expect(manifest.agentPrefixes).toContain(".codex");
    expect(manifest.agentPrefixes).toContain(".grok");
    expect(manifest.agentPathPrefixes).toContain(".github/skills/");
    expect(manifest.agentPathPrefixes).toContain(".agents/skills/");
    expect(manifest.agentPathPrefixes).not.toContain(".github/");
    expect(manifest.agentPathPrefixes).not.toContain(".agents/");
  });

  it("nonAgentConfigDirs equals NON_AGENT_CONFIG_DIRS", () => {
    const manifest = buildAgentsManifest();
    expect(manifest.nonAgentConfigDirs).toEqual([...NON_AGENT_CONFIG_DIRS]);
  });

  it("agentPrefixes contains common known prefixes", () => {
    const manifest = buildAgentsManifest();
    expect(manifest.agentPrefixes).toContain(".claude");
    expect(manifest.agentPrefixes).toContain(".cursor");
    expect(manifest.agentPrefixes).toContain(".amp");
  });
});
