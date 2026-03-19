import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, lstatSync, readlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import os, { tmpdir } from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import {
  installSymlink,
  installCopy,
  createRelativeSymlink,
  ensureCanonicalDir,
  resolveAgentSkillsDir,
} from "./canonical.js";

// Controlled mock for symlinkSync to test symlink-failure fallback path (TC-103)
const { getForceSymlinkFailure, setForceSymlinkFailure } = vi.hoisted(() => {
  let force = false;
  return {
    getForceSymlinkFailure: () => force,
    setForceSymlinkFailure: (v: boolean) => { force = v; },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    symlinkSync: ((...args: any[]) => {
      if (getForceSymlinkFailure()) {
        throw new Error("Mocked EPERM: symlink creation not permitted");
      }
      return (original.symlinkSync as Function)(...args);
    }),
  };
});

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
      const dir = ensureCanonicalDir(tempDir, false);
      expect(dir).toBe(join(tempDir, ".agents", "skills"));
      expect(lstatSync(dir).isDirectory()).toBe(true);
    });

    it("is idempotent - does not throw if dir exists", () => {
      ensureCanonicalDir(tempDir, false);
      expect(() => ensureCanonicalDir(tempDir, false)).not.toThrow();
    });

    it("throws when base is home directory for non-global install", () => {
      const homedir = os.homedir();
      expect(() => ensureCanonicalDir(homedir, false)).toThrow(
        "home directory",
      );
    });

    it("allows home directory for global install", () => {
      // Global install ignores base — always uses ~/.agents/skills
      expect(() => ensureCanonicalDir(os.homedir(), true)).not.toThrow();
    });
  });

  describe("resolveAgentSkillsDir", () => {
    it("returns projectRoot + localSkillsDir for local installs", () => {
      const agent = makeAgent({ localSkillsDir: ".cursor/skills" });
      const result = resolveAgentSkillsDir(agent, {
        global: false,
        projectRoot: tempDir,
      });
      expect(result).toBe(join(tempDir, ".cursor", "skills"));
    });

    it("throws on path traversal in localSkillsDir", () => {
      const agent = makeAgent({ localSkillsDir: "../../.evil/skills" });
      expect(() =>
        resolveAgentSkillsDir(agent, {
          global: false,
          projectRoot: tempDir,
        }),
      ).toThrow("Path traversal");
    });

    it("rejects sibling directory escape via prefix confusion", () => {
      // /tmp/a + ../ab = /tmp/ab — looks like it starts with /tmp/a but escapes
      const agent = makeAgent({ localSkillsDir: "../" + tempDir.split("/").pop() + "b" });
      expect(() =>
        resolveAgentSkillsDir(agent, {
          global: false,
          projectRoot: tempDir,
        }),
      ).toThrow("Path traversal");
    });

    it("allows normal dotfolder paths", () => {
      const agent = makeAgent({ localSkillsDir: ".aider/skills" });
      expect(() =>
        resolveAgentSkillsDir(agent, {
          global: false,
          projectRoot: tempDir,
        }),
      ).not.toThrow();
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
    it("creates canonical dir with SKILL.md and symlinks for non-fallback agents", () => {
      const agents = [
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
        makeAgent({ id: "windsurf", localSkillsDir: ".windsurf/skills" }),
      ];

      const result = installSymlink("my-skill", "# My Skill\nContent here", agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Canonical SKILL.md exists with frontmatter
      const canonicalPath = join(tempDir, ".agents", "skills", "my-skill", "SKILL.md");
      const canonicalContent = readFileSync(canonicalPath, "utf-8");
      expect(canonicalContent).toContain("name: my-skill");
      expect(canonicalContent).toContain("# My Skill\nContent here");

      // Each agent dir has a symlink
      const cursorLink = join(tempDir, ".cursor", "skills", "my-skill");
      expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);

      const windsurfLink = join(tempDir, ".windsurf", "skills", "my-skill");
      expect(lstatSync(windsurfLink).isSymbolicLink()).toBe(true);

      // Returned paths include all locations
      expect(result).toHaveLength(2);
    });

    it("uses copy fallback for Claude Code (known symlink issues)", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const result = installSymlink("my-skill", "# My Skill\nContent here", agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Claude Code gets a direct copy (not a symlink)
      const claudePath = join(tempDir, ".claude", "skills", "my-skill");
      expect(lstatSync(claudePath).isDirectory()).toBe(true);
      expect(lstatSync(claudePath).isSymbolicLink()).toBe(false);
      const claudeContent = readFileSync(join(claudePath, "SKILL.md"), "utf-8");
      expect(claudeContent).toContain("name: my-skill");
      expect(claudeContent).toContain("# My Skill\nContent here");

      // Cursor gets a symlink
      const cursorLink = join(tempDir, ".cursor", "skills", "my-skill");
      expect(lstatSync(cursorLink).isSymbolicLink()).toBe(true);

      expect(result).toHaveLength(2);
    });

    it("installs agent files in canonical dir and copy-fallback agents", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const agentFiles = {
        "agents/frontend.md": "# Frontend Agent",
        "agents/testing.md": "# Testing Agent",
      };

      installSymlink("team-lead", "# Team Lead", agents, {
        global: false,
        projectRoot: tempDir,
      }, agentFiles);

      // Canonical dir gets agent files
      const canonicalAgentsDir = join(tempDir, ".agents", "skills", "team-lead", "agents");
      expect(readFileSync(join(canonicalAgentsDir, "frontend.md"), "utf-8")).toBe("# Frontend Agent");
      expect(readFileSync(join(canonicalAgentsDir, "testing.md"), "utf-8")).toBe("# Testing Agent");

      // Claude Code (copy fallback) gets agent files directly
      const claudeAgentsDir = join(tempDir, ".claude", "skills", "team-lead", "agents");
      expect(readFileSync(join(claudeAgentsDir, "frontend.md"), "utf-8")).toBe("# Frontend Agent");
      expect(readFileSync(join(claudeAgentsDir, "testing.md"), "utf-8")).toBe("# Testing Agent");

      // Cursor (symlinked) resolves agents via symlink to canonical
      const cursorAgentFile = join(tempDir, ".cursor", "skills", "team-lead", "agents", "frontend.md");
      expect(readFileSync(cursorAgentFile, "utf-8")).toBe("# Frontend Agent");
    });

    it("overwrites existing symlink or directory at target", () => {
      const agents = [makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" })];

      // Pre-create a regular directory at the target
      const existingDir = join(tempDir, ".cursor", "skills", "my-skill");
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

      // Each agent has its own copy with frontmatter
      const claudePath = join(tempDir, ".claude", "commands", "my-skill", "SKILL.md");
      const claudeCopyContent = readFileSync(claudePath, "utf-8");
      expect(claudeCopyContent).toContain("name: my-skill");
      expect(claudeCopyContent).toContain("# My Skill\nContent");

      const cursorPath = join(tempDir, ".cursor", "skills", "my-skill", "SKILL.md");
      const cursorCopyContent = readFileSync(cursorPath, "utf-8");
      expect(cursorCopyContent).toContain("name: my-skill");
      expect(cursorCopyContent).toContain("# My Skill\nContent");

      // No canonical .agents/ directory
      const canonicalDir = join(tempDir, ".agents");
      expect(() => lstatSync(canonicalDir)).toThrow();

      expect(result).toHaveLength(2);
    });

    it("installs agent files alongside SKILL.md in each agent directory", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/commands" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const agentFiles = {
        "agents/frontend.md": "# Frontend Agent\nYou are the FRONTEND agent.",
        "agents/backend.md": "# Backend Agent\nYou are the BACKEND agent.",
      };

      installCopy("team-lead", "# Team Lead", agents, {
        global: false,
        projectRoot: tempDir,
      }, agentFiles);

      // Each agent dir gets agents/*.md files
      for (const dir of [".claude/commands", ".cursor/skills"]) {
        const frontendPath = join(tempDir, dir, "team-lead", "agents", "frontend.md");
        const backendPath = join(tempDir, dir, "team-lead", "agents", "backend.md");
        expect(readFileSync(frontendPath, "utf-8")).toBe("# Frontend Agent\nYou are the FRONTEND agent.");
        expect(readFileSync(backendPath, "utf-8")).toBe("# Backend Agent\nYou are the BACKEND agent.");
      }
    });

    it("works correctly without agentFiles (backward compatible)", () => {
      const agents = [makeAgent({ id: "claude-code", localSkillsDir: ".claude/commands" })];

      installCopy("simple-skill", "# Simple", agents, {
        global: false,
        projectRoot: tempDir,
      });

      const skillPath = join(tempDir, ".claude", "commands", "simple-skill", "SKILL.md");
      const simpleContent = readFileSync(skillPath, "utf-8");
      expect(simpleContent).toContain("name: simple-skill");
      expect(simpleContent).toContain("# Simple");
      // No agents/ directory created
      expect(existsSync(join(tempDir, ".claude", "commands", "simple-skill", "agents"))).toBe(false);
    });

    it("rejects localSkillsDir with path traversal", () => {
      const agents = [
        makeAgent({ id: "evil", localSkillsDir: "../../.evil/skills" }),
      ];

      expect(() =>
        installCopy("test-skill", "# Content", agents, {
          global: false,
          projectRoot: tempDir,
        }),
      ).toThrow("Path traversal");
    });

    it("installs to explicit projectRoot, not a parent directory", () => {
      // Simulates bug: user runs from /Projects/vskill-test/ but
      // findProjectRoot resolves to parent /Projects/
      const parentDir = join(tempDir, "Projects");
      const userCwd = join(parentDir, "vskill-test");
      mkdirSync(userCwd, { recursive: true });

      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
      ];

      // Pass userCwd explicitly as projectRoot (the fix)
      const result = installCopy("remotion", "# Remotion\nCreate videos", agents, {
        global: false,
        projectRoot: userCwd,
      });

      // Skill should be under vskill-test, NOT under Projects/
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("vskill-test");
      expect(result[0]).not.toContain(join("Projects", ".claude"));

      // Verify the file actually exists at the correct location with frontmatter
      const skillPath = join(userCwd, ".claude", "skills", "remotion", "SKILL.md");
      const remotionContent = readFileSync(skillPath, "utf-8");
      expect(remotionContent).toContain("name: remotion");
      expect(remotionContent).toContain("# Remotion\nCreate videos");
    });
  });

  describe("frontmatter integration", () => {
    it("TC-101: installSymlink writes canonical SKILL.md with name in frontmatter", () => {
      const agents = [
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      installSymlink("my-skill", "# My Skill\nThis does things.", agents, {
        global: false,
        projectRoot: tempDir,
      });

      const canonicalPath = join(tempDir, ".agents", "skills", "my-skill", "SKILL.md");
      const written = readFileSync(canonicalPath, "utf-8");
      expect(written).toMatch(/^---\n[\s\S]*name: my-skill[\s\S]*\n---/);
      expect(written).toContain("# My Skill\nThis does things.");
    });

    it("TC-102: installSymlink copy-fallback for claude-code agent gets frontmatter", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
      ];

      installSymlink("my-skill", "# My Skill\nThis does things.", agents, {
        global: false,
        projectRoot: tempDir,
      });

      const claudePath = join(tempDir, ".claude", "skills", "my-skill", "SKILL.md");
      const written = readFileSync(claudePath, "utf-8");
      expect(written).toMatch(/^---\n[\s\S]*name: my-skill[\s\S]*\n---/);
      expect(written).toContain("# My Skill\nThis does things.");
    });

    it("TC-103: symlink-failure fallback writes SKILL.md with frontmatter", () => {
      setForceSymlinkFailure(true);
      try {
        const agents = [
          makeAgent({ id: "test-agent", localSkillsDir: ".test-agent/skills" }),
        ];

        installSymlink("my-skill", "# My Skill\nThis does things.", agents, {
          global: false,
          projectRoot: tempDir,
        });

        // Symlink failed → fallback direct copy should still have frontmatter
        const fallbackPath = join(tempDir, ".test-agent", "skills", "my-skill", "SKILL.md");
        const written = readFileSync(fallbackPath, "utf-8");
        expect(written).toMatch(/^---\n[\s\S]*name: my-skill[\s\S]*\n---/);
        expect(written).toContain("# My Skill\nThis does things.");
      } finally {
        setForceSymlinkFailure(false);
      }
    });

    it("TC-104: installCopy writes SKILL.md with name in frontmatter", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/commands" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      installCopy("my-skill", "# My Skill\nThis does things.", agents, {
        global: false,
        projectRoot: tempDir,
      });

      const claudePath = join(tempDir, ".claude", "commands", "my-skill", "SKILL.md");
      const claudeContent = readFileSync(claudePath, "utf-8");
      expect(claudeContent).toMatch(/^---\n[\s\S]*name: my-skill[\s\S]*\n---/);
      expect(claudeContent).toContain("# My Skill\nThis does things.");

      const cursorPath = join(tempDir, ".cursor", "skills", "my-skill", "SKILL.md");
      const cursorContent = readFileSync(cursorPath, "utf-8");
      expect(cursorContent).toMatch(/^---\n[\s\S]*name: my-skill[\s\S]*\n---/);
      expect(cursorContent).toContain("# My Skill\nThis does things.");
    });

    it("TC-105: existing frontmatter name preserved, not overwritten by skillName", () => {
      const agents = [
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      const content = "---\nname: custom-name\ndescription: Custom desc\n---\n# Body";

      installSymlink("my-skill", content, agents, {
        global: false,
        projectRoot: tempDir,
      });

      const canonicalPath = join(tempDir, ".agents", "skills", "my-skill", "SKILL.md");
      const written = readFileSync(canonicalPath, "utf-8");
      expect(written).toContain("name: custom-name");
      expect(written).not.toContain("name: my-skill");
    });
  });

  describe("Claude field stripping", () => {
    const CLAUDE_CONTENT = [
      "---",
      "description: PM skill",
      "argument-hint: \"[topic]\"",
      "context: fork",
      "model: opus",
      "user-invocable: true",
      "allowed-tools: Read,Write,Grep",
      "---",
      "# PM Skill body",
    ].join("\n");

    it("installSymlink: Claude Code copy keeps all fields", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
      ];

      installSymlink("pm", CLAUDE_CONTENT, agents, {
        global: false,
        projectRoot: tempDir,
      });

      const claudePath = join(tempDir, ".claude", "skills", "pm", "SKILL.md");
      const written = readFileSync(claudePath, "utf-8");
      expect(written).toContain("model: opus");
      expect(written).toContain("user-invocable: true");
      expect(written).toContain("allowed-tools:");
      expect(written).toContain("context: fork");
      expect(written).toContain("argument-hint:");
    });

    it("installSymlink: canonical (non-Claude) strips Claude fields", () => {
      const agents = [
        makeAgent({ id: "opencode", localSkillsDir: ".opencode/skills" }),
      ];

      installSymlink("pm", CLAUDE_CONTENT, agents, {
        global: false,
        projectRoot: tempDir,
      });

      const canonicalPath = join(tempDir, ".agents", "skills", "pm", "SKILL.md");
      const written = readFileSync(canonicalPath, "utf-8");
      expect(written).toContain("name: pm");
      expect(written).toContain("description: PM skill");
      expect(written).not.toContain("model:");
      expect(written).not.toContain("user-invocable");
      expect(written).not.toContain("allowed-tools:");
      expect(written).not.toContain("context:");
      expect(written).not.toContain("argument-hint:");
      expect(written).toContain("# PM Skill body");
    });

    it("installSymlink: symlink-failure fallback uses stripped content", () => {
      setForceSymlinkFailure(true);
      try {
        const agents = [
          makeAgent({ id: "opencode", localSkillsDir: ".opencode/skills" }),
        ];

        installSymlink("pm", CLAUDE_CONTENT, agents, {
          global: false,
          projectRoot: tempDir,
        });

        const fallbackPath = join(tempDir, ".opencode", "skills", "pm", "SKILL.md");
        const written = readFileSync(fallbackPath, "utf-8");
        expect(written).not.toContain("model:");
        expect(written).not.toContain("user-invocable");
        expect(written).toContain("name: pm");
        expect(written).toContain("description: PM skill");
      } finally {
        setForceSymlinkFailure(false);
      }
    });

    it("installCopy: Claude keeps fields, non-Claude strips them", () => {
      const agents = [
        makeAgent({ id: "claude-code", localSkillsDir: ".claude/skills" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];

      installCopy("pm", CLAUDE_CONTENT, agents, {
        global: false,
        projectRoot: tempDir,
      });

      // Claude keeps all fields
      const claudeContent = readFileSync(
        join(tempDir, ".claude", "skills", "pm", "SKILL.md"), "utf-8"
      );
      expect(claudeContent).toContain("model: opus");
      expect(claudeContent).toContain("user-invocable: true");

      // Cursor gets stripped
      const cursorContent = readFileSync(
        join(tempDir, ".cursor", "skills", "pm", "SKILL.md"), "utf-8"
      );
      expect(cursorContent).not.toContain("model:");
      expect(cursorContent).not.toContain("user-invocable");
      expect(cursorContent).toContain("name: pm");
      expect(cursorContent).toContain("description: PM skill");
    });
  });
});
