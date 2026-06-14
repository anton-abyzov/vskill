// F9 — CLI installs must run the SAME per-agent dispatch as Studio.
//
// Before F9 the CLI path (commands/add.ts) called installSymlink/installCopy
// directly and NEVER consulted agent.formatTransformer, so Tier-2 agents got a
// dead-letter <agent>/skills/<name>/SKILL.md instead of their real artifact
// (cursor → .cursor/rules/<name>.mdc, windsurf → .windsurf/rules, copilot →
// instructions, aider → conventions + conf.yml).
//
// These tests drive `installSkillToAgents` — the extracted dispatch the CLI now
// shares with installSkillToMultipleAgents — and assert the per-agent expected
// artifact paths land on a real filesystem.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { installSkillToAgents } from "../multi-install.js";
import { AGENTS_REGISTRY } from "../../agents/agents-registry.js";
import type { AgentDefinition } from "../../agents/agents-registry.js";

const RAW_SKILL = `---
name: obsidian-brain
description: PARA + LLM Wiki
version: 1.2.3
---

## Body

Notes go in raw/inbox.
`;

function agent(id: string): AgentDefinition {
  const a = AGENTS_REGISTRY.find((x) => x.id === id);
  if (!a) throw new Error(`test setup: unknown agent ${id}`);
  return a;
}

let workDir: string;
let homeBackup: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "vskill-cli-dispatch-"));
  homeBackup = process.env.HOME;
  process.env.HOME = workDir;
});

afterEach(() => {
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  rmSync(workDir, { recursive: true, force: true });
});

describe("installSkillToAgents — CLI shares Studio's per-agent dispatch (F9)", () => {
  it("claude-code (Tier 1) writes full-frontmatter SKILL.md under .claude/skills/<name>/", () => {
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("claude-code")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const expected = join(workDir, ".claude", "skills", "obsidian-brain", "SKILL.md");
    expect(existsSync(expected)).toBe(true);
    const content = readFileSync(expected, "utf8");
    // claude-code keeps full frontmatter (COPY_FALLBACK path).
    expect(content).toContain("name: obsidian-brain");
    expect(content).toContain("Notes go in raw/inbox.");
    expect(locations.some((l) => l.includes(join(".claude", "skills", "obsidian-brain")))).toBe(true);
  });

  it("cursor (Tier 2) writes .cursor/rules/<name>.mdc, NOT a dead-letter .cursor/skills symlink", () => {
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("cursor")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const expected = join(workDir, ".cursor", "rules", "obsidian-brain.mdc");
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, "utf8")).toContain("alwaysApply: false");
    // Dead-letter location must NOT be created.
    const deadLetter = join(workDir, ".cursor", "skills", "obsidian-brain", "SKILL.md");
    expect(existsSync(deadLetter)).toBe(false);
  });

  it("windsurf (Tier 2) writes rules/<name>.md under its install root", () => {
    // user-scope globalSkillsDir is ~/.codeium/windsurf/skills, so the install
    // root (its parent) is ~/.codeium/windsurf and the transformer emits
    // rules/<name>.md there.
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("windsurf")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const expected = join(workDir, ".codeium", "windsurf", "rules", "obsidian-brain.md");
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, "utf8")).toContain("Notes go in raw/inbox.");
  });

  it("github-copilot-ext (Tier 2) project scope writes .github/instructions/<name>.instructions.md", () => {
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("github-copilot-ext")],
      scope: "project",
      projectRoot: workDir,
      copy: false,
    });
    const expected = join(workDir, ".github", "instructions", "obsidian-brain.instructions.md");
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, "utf8")).toContain(`applyTo: "**"`);
  });

  it("aider (Tier 2) writes conventions file and appends to .aider.conf.yml", () => {
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("aider")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const convPath = join(workDir, ".aider", "conventions", "obsidian-brain.md");
    expect(existsSync(convPath)).toBe(true);
    const confPath = join(workDir, ".aider.conf.yml");
    expect(existsSync(confPath)).toBe(true);
    expect(readFileSync(confPath, "utf8")).toContain("obsidian-brain.md");
  });

  it("codex (Tier 1) writes SKILL.md under .codex/skills/<name>/", () => {
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("codex")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    // Codex is a non-copy-fallback Tier-1 agent: canonical store + symlink.
    const canonical = join(workDir, ".agents", "skills", "obsidian-brain", "SKILL.md");
    expect(existsSync(canonical)).toBe(true);
    const link = join(workDir, ".codex", "skills", "obsidian-brain");
    expect(existsSync(link)).toBe(true);
  });

  it("mixed Tier-1 + Tier-2 batch dispatches each agent to its own artifact path", () => {
    installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("claude-code"), agent("cursor"), agent("windsurf")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    expect(existsSync(join(workDir, ".claude", "skills", "obsidian-brain", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workDir, ".cursor", "rules", "obsidian-brain.mdc"))).toBe(true);
    expect(existsSync(join(workDir, ".codeium", "windsurf", "rules", "obsidian-brain.md"))).toBe(true);
  });
});
