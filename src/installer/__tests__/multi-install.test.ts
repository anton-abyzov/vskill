// 0845 T-011/T-016 — installSkillToMultipleAgents unit tests.
//
// Sequential per-agent loop (FR-002). Per-agent try/catch isolation so
// one transformer's failure does NOT abort the others (AC-US4-10). Path
// traversal guard via path.relative (AC-US4-11). Tier-3 dispatch to
// buildClipboardBlob with no disk write (AC-US5-07). Tier-3 + project
// scope downgrades to user-scope blob with detail warning (T-016).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { installSkillToMultipleAgents } from "../multi-install.js";
import type { ParsedSkill } from "../transformers/index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Body\n\nNotes go in raw/inbox.\n",
  originalFrontmatter: "name: obsidian-brain\ndescription: PARA + LLM Wiki",
};

let workDir: string;
let homeBackup: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "vskill-multi-install-"));
  // Sandbox HOME so global installs land under workDir. resolveTilde
  // reads process.env.HOME at call time, so this swap is enough.
  homeBackup = process.env.HOME;
  process.env.HOME = workDir;
});

afterEach(() => {
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  rmSync(workDir, { recursive: true, force: true });
});

describe("installSkillToMultipleAgents — dispatch matrix", () => {
  it("Tier 1 (claude-code) writes SKILL.md under ~/.claude/skills/<name>/", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["claude-code"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].status).toBe("installed");
    const expected = join(workDir, ".claude", "skills", "obsidian-brain", "SKILL.md");
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, "utf8")).toContain("PARA + LLM Wiki");
  });

  it("Tier 2 (cursor) writes .mdc under ~/.cursor/rules/<name>.mdc (transformer path)", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["cursor"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents[0].status).toBe("installed");
    const expected = join(workDir, ".cursor", "rules", "obsidian-brain.mdc");
    expect(existsSync(expected)).toBe(true);
    const content = readFileSync(expected, "utf8");
    expect(content).toContain("alwaysApply: false");
    expect(content).toContain(skill.body);
  });

  it("Tier 3 (chatgpt) is `exported` with a blob and NO filesystem write", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["chatgpt"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents[0].status).toBe("exported");
    expect(result.agents[0].blob).toContain("obsidian-brain");
    expect(result.agents[0].pasteInstructionsUrl).toMatch(/^https:/);
    expect(result.exportedCount).toBe(1);
    expect(result.installedCount).toBe(0);
    // The Tier 3 chatgpt globalSkillsDir is `~/.chatgpt/skills` — confirm
    // no file landed there (AC-US5-07).
    const wouldBe = join(workDir, ".chatgpt", "skills", "obsidian-brain", "SKILL.md");
    expect(existsSync(wouldBe)).toBe(false);
  });

  it("mixed install (claude-code + cursor + chatgpt) returns three result rows", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["claude-code", "cursor", "chatgpt"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents).toHaveLength(3);
    expect(result.agents.map((a) => a.agentId)).toEqual(["claude-code", "cursor", "chatgpt"]);
    expect(result.installedCount).toBe(2);
    expect(result.exportedCount).toBe(1);
  });
});

describe("installSkillToMultipleAgents — error isolation (AC-US4-10)", () => {
  it("a transformer that throws fails only its own target", async () => {
    // Inject a throwing transformer by overriding the cursor registry entry
    // for this test. Cleanup is automatic — vitest module isolation per file.
    const { AGENTS_REGISTRY } = await import("../../agents/agents-registry.js");
    const cursorAgent = AGENTS_REGISTRY.find((a) => a.id === "cursor");
    const originalTransformer = cursorAgent?.formatTransformer;
    if (cursorAgent) {
      cursorAgent.formatTransformer = () => {
        throw new Error("synthetic-cursor-failure");
      };
    }
    try {
      const result = await installSkillToMultipleAgents({
        skill,
        agentIds: ["claude-code", "cursor", "windsurf"],
        scope: "user",
        projectRoot: workDir,
      });
      const byId = Object.fromEntries(result.agents.map((a) => [a.agentId, a]));
      expect(byId["claude-code"].status).toBe("installed");
      expect(byId["cursor"].status).toBe("error");
      expect(byId["cursor"].detail).toContain("synthetic-cursor-failure");
      expect(byId["windsurf"].status).toBe("installed");
      expect(result.errorCount).toBe(1);
    } finally {
      if (cursorAgent && originalTransformer) {
        cursorAgent.formatTransformer = originalTransformer;
      }
    }
  });

  it("unknown agentId returns status=error, does not abort others", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["claude-code", "no-such-agent"],
      scope: "user",
      projectRoot: workDir,
    });
    const byId = Object.fromEntries(result.agents.map((a) => [a.agentId, a]));
    expect(byId["claude-code"].status).toBe("installed");
    expect(byId["no-such-agent"].status).toBe("error");
    expect(byId["no-such-agent"].detail).toMatch(/unknown/i);
  });
});

describe("installSkillToMultipleAgents — path traversal guard (AC-US4-11)", () => {
  it("rejects a transformer whose relativePath escapes the install root", async () => {
    const { AGENTS_REGISTRY } = await import("../../agents/agents-registry.js");
    const cursorAgent = AGENTS_REGISTRY.find((a) => a.id === "cursor");
    const original = cursorAgent?.formatTransformer;
    if (cursorAgent) {
      cursorAgent.formatTransformer = () => [
        { relativePath: "../../../etc/passwd", content: "pwned" },
      ];
    }
    try {
      const result = await installSkillToMultipleAgents({
        skill,
        agentIds: ["cursor"],
        scope: "user",
        projectRoot: workDir,
      });
      expect(result.agents[0].status).toBe("error");
      expect(result.agents[0].detail).toMatch(/traversal|escape/i);
      // Nothing landed at the malicious location.
      expect(existsSync("/etc/passwd-vskill-pwned")).toBe(false);
    } finally {
      if (cursorAgent && original) cursorAgent.formatTransformer = original;
    }
  });
});

describe("installSkillToMultipleAgents — Tier 3 scope downgrade (T-016, AC-US5-06)", () => {
  it("project-scope + Tier 3 agent → exported with downgrade warning", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["chatgpt"],
      scope: "project",
      projectRoot: workDir,
    });
    expect(result.agents[0].status).toBe("exported");
    expect(result.agents[0].detail).toContain("does not support project-scoped skills");
    expect(result.agents[0].blob).toBeDefined();
  });

  it("user-scope + Tier 3 agent → exported without downgrade warning", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["chatgpt"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents[0].status).toBe("exported");
    expect(result.agents[0].detail ?? "").not.toContain("does not support project-scoped skills");
  });
});

describe("installSkillToMultipleAgents — Aider conf.yml mutation", () => {
  it("appends to .aider.conf.yml under HOME via safeAppendYamlList", async () => {
    const result = await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    expect(result.agents[0].status).toBe("installed");
    // Conventions file at ~/.aider/conventions/<name>.md
    const convPath = join(workDir, ".aider", "conventions", "obsidian-brain.md");
    expect(existsSync(convPath)).toBe(true);
    expect(readFileSync(convPath, "utf8")).toContain(skill.body);
    // conf.yml at $HOME
    const confPath = join(workDir, ".aider.conf.yml");
    expect(existsSync(confPath)).toBe(true);
    expect(readFileSync(confPath, "utf8")).toContain("~/.aider/conventions/obsidian-brain.md");
  });

  it("is idempotent — re-installing aider twice does not duplicate the conf.yml entry", async () => {
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    const confPath = join(workDir, ".aider.conf.yml");
    const content = readFileSync(confPath, "utf8");
    const occurrences = content.match(/obsidian-brain/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("conf.yml with pre-existing read: list is appended to, not replaced", async () => {
    const homeDir = workDir;
    writeFileSync(
      join(homeDir, ".aider.conf.yml"),
      "model: gpt-4\nread:\n  - ~/.aider/other.md\n",
    );
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    const content = readFileSync(join(homeDir, ".aider.conf.yml"), "utf8");
    expect(content).toContain("~/.aider/other.md");
    expect(content).toContain("~/.aider/conventions/obsidian-brain.md");
    expect(content).toContain("model: gpt-4");
  });
});
