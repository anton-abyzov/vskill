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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
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

  it("cursor (reads shared ~/.agents/skills, 0894) gets only the canonical folder — no ~/.cursor link, rule or copy", () => {
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("cursor")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const canonical = join(workDir, ".agents", "skills", "obsidian-brain");
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    expect(locations).toEqual([canonical]);
    expect(existsSync(join(workDir, ".cursor"))).toBe(false);
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

  it("one agent's unusable config skips that agent, not the whole install (0894)", () => {
    writeFileSync(join(workDir, ".aider.conf.yml"), "read: [[/nested.md]]\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const locations = installSkillToAgents({
        skillName: "obsidian-brain",
        rawContent: RAW_SKILL,
        agents: [agent("claude-code"), agent("aider")],
        scope: "user",
        projectRoot: workDir,
        copy: false,
      });
      expect(existsSync(join(workDir, ".claude", "skills", "obsidian-brain", "SKILL.md"))).toBe(true);
      expect(locations.length).toBeGreaterThan(0);
      expect(warn.mock.calls.flat().join(" ")).toContain("aider");
    } finally {
      warn.mockRestore();
    }
  });

  it("throws when every agent fails", () => {
    writeFileSync(join(workDir, ".aider.conf.yml"), "read: [[/nested.md]]\n");
    expect(() =>
      installSkillToAgents({
        skillName: "obsidian-brain",
        rawContent: RAW_SKILL,
        agents: [agent("aider")],
        scope: "user",
        projectRoot: workDir,
        copy: false,
      }),
    ).toThrow(/aider/);
  });

  it("codex global install (0894) writes only ~/.agents/skills/<name>", () => {
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("codex")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    const canonical = join(workDir, ".agents", "skills", "obsidian-brain");
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    expect(lstatSync(canonical).isSymbolicLink()).toBe(false);
    expect(locations).toEqual([canonical]);
    expect(existsSync(join(workDir, ".codex"))).toBe(false);
  });

  it("codex --copy global install (0894) also writes only ~/.agents/skills/<name>", () => {
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("codex"), agent("cursor")],
      scope: "user",
      projectRoot: workDir,
      copy: true,
    });
    const canonical = join(workDir, ".agents", "skills", "obsidian-brain");
    expect(locations).toEqual([canonical]);
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    expect(existsSync(join(workDir, ".cursor"))).toBe(false);
  });

  it("antigravity global install (0894) still links its own dir to the canonical folder", () => {
    const prev = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
    delete process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
    try {
      installSkillToAgents({
        skillName: "obsidian-brain",
        rawContent: RAW_SKILL,
        agents: [agent("antigravity")],
        scope: "user",
        projectRoot: workDir,
        copy: false,
      });
    } finally {
      if (prev !== undefined) process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR = prev;
    }
    const link = join(workDir, ".gemini", "config", "skills", "obsidian-brain");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(join(workDir, ".agents", "skills", "obsidian-brain")));
  });

  it("antigravity project install (0894) needs no link: .agents/skills is its project dir", () => {
    const project = join(workDir, "project");
    mkdirSync(project);
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("antigravity"), agent("grok")],
      scope: "project",
      projectRoot: project,
      copy: false,
    });
    const canonical = join(project, ".agents", "skills", "obsidian-brain");
    // grok does not read the shared folder in project scope, so it gets a link.
    const grokLink = join(project, ".grok", "skills", "obsidian-brain");
    expect(locations).toEqual([canonical, grokLink]);
    expect(lstatSync(grokLink).isSymbolicLink()).toBe(true);
    expect(existsSync(join(project, ".agent"))).toBe(false);
  });

  it("grok global install (0894) writes only the canonical folder", () => {
    const locations = installSkillToAgents({
      skillName: "obsidian-brain",
      rawContent: RAW_SKILL,
      agents: [agent("grok")],
      scope: "user",
      projectRoot: workDir,
      copy: false,
    });
    expect(locations).toEqual([join(workDir, ".agents", "skills", "obsidian-brain")]);
    expect(existsSync(join(workDir, ".grok"))).toBe(false);
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
    // 0894: cursor reads ~/.agents/skills, so it is served by the canonical folder.
    expect(existsSync(join(workDir, ".agents", "skills", "obsidian-brain", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workDir, ".cursor"))).toBe(false);
    expect(existsSync(join(workDir, ".codeium", "windsurf", "rules", "obsidian-brain.md"))).toBe(true);
  });
});
