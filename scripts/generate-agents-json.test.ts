import { describe, it, expect } from "vitest";
import { buildAgentsManifest } from "./generate-agents-json.js";
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
    for (const a of AGENTS_REGISTRY) {
      const first = a.localSkillsDir.split("/")[0];
      if (first) expected.add(first);
    }
    expect(new Set(manifest.agentPrefixes)).toEqual(expected);
  });

  it("agentPrefixes count matches deduped count from registry", () => {
    const manifest = buildAgentsManifest();
    const deduped = new Set(
      AGENTS_REGISTRY.map((a) => a.localSkillsDir.split("/")[0]).filter(Boolean),
    );
    expect(manifest.agentPrefixes).toHaveLength(deduped.size);
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
