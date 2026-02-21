import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import {
  installSymlink,
  installCopy,
  createRelativeSymlink,
  ensureCanonicalDir,
} from "./canonical.js";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/commands",
    globalSkillsDir: "~/.claude/commands",
    isUniversal: false,
    detectInstalled: "which claude",
    parentCompany: "Anthropic",
    featureSupport: {
      slashCommands: true,
      hooks: true,
      mcp: true,
      customSystemPrompt: true,
    },
    ...overrides,
  };
}

describe("canonical installer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-canonical-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("ensureCanonicalDir", () => {
    it("creates .agents/skills/ directory under base", () => {
      const dir = ensureCanonicalDir(tempDir);
      expect(dir).toBe(join(tempDir, ".agents", "skills"));
      expect(lstatSync(dir).isDirectory()).toBe(true);
    });

    it("is idempotent - does not throw if dir exists", () => {
      ensureCanonicalDir(tempDir);
      expect(() => ensureCanonicalDir(tempDir)).not.toThrow();
    });
  });

  describe("createRelativeSymlink", () => {
    it("creates a symlink with correct relative path", () => {
      const canonicalDir = join(tempDir, ".agents", "skills", "my-skill");
      const agentDir = join(tempDir, ".claude", "commands", "my-skill");
      mkdirSync(canonicalDir, { recursive: true });
      mkdirSync(join(tempDir, ".claude", "commands"), { recursive: true });

      const result = createRelativeSymlink(canonicalDir, agentDir);

      expect(result).toBe(true);
      expect(lstatSync(agentDir).isSymbolicLink()).toBe(true);
      const target = readlinkSync(agentDir);
      expect(target).toBe(join("..", "..", ".agents", "skills", "my-skill"));
    });

    it("returns false when symlink creation fails", () => {
      // Target doesn't exist, but we mock fs to throw EPERM
      const result = createRelativeSymlink(
        "/nonexistent/path",
        "/also/nonexistent",
      );

      expect(result).toBe(false);
    });
  });

  describe("installSymlink", () => {
    it("creates canonical dir with SKILL.md and symlinks for each agent", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/commands" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const result = installSymlink("my-skill", "# My Skill\nContent here", agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Canonical SKILL.md exists
      const canonicalPath = join(tempDir, ".agents", "skills", "my-skill", "SKILL.md");
      expect(readFileSync(canonicalPath, "utf-8")).toBe("# My Skill\nContent here");

      // Each agent dir has a symlink
      const claudeLink = join(tempDir, ".claude", "commands", "my-skill");
      expect(lstatSync(claudeLink).isSymbolicLink()).toBe(true);

      const cursorLink = join(tempDir, ".cursor", "skills", "my-skill");
      expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);

      // Returned paths include all locations
      expect(result).toHaveLength(2);
    });

    it("overwrites existing symlink or directory at target", () => {
      const agents = [makeAgent()];

      // Pre-create a regular directory at the target
      const existingDir = join(tempDir, ".claude", "commands", "my-skill");
      mkdirSync(existingDir, { recursive: true });

      installSymlink("my-skill", "# Content", agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Should now be a symlink, not a directory
      expect(lstatSync(existingDir).isSymbolicLink()).toBe(true);
    });
  });

  describe("installCopy", () => {
    it("creates independent copies in each agent directory", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/commands" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const result = installCopy("my-skill", "# My Skill\nContent", agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Each agent has its own copy
      const claudePath = join(tempDir, ".claude", "commands", "my-skill", "SKILL.md");
      expect(readFileSync(claudePath, "utf-8")).toBe("# My Skill\nContent");

      const cursorPath = join(tempDir, ".cursor", "skills", "my-skill", "SKILL.md");
      expect(readFileSync(cursorPath, "utf-8")).toBe("# My Skill\nContent");

      // No canonical .agents/ directory
      const canonicalDir = join(tempDir, ".agents");
      expect(() => lstatSync(canonicalDir)).toThrow();

      expect(result).toHaveLength(2);
    });
  });
});
