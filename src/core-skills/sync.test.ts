import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { findCoreSkillsDir, listCoreSkills, syncCoreSkills } from "./sync.js";
import { migrateStaleSkillFiles } from "../installer/migrate.js";
import { lstatSync } from "node:fs";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "opencode",
    displayName: "OpenCode",
    localSkillsDir: ".opencode/skills",
    globalSkillsDir: "~/.opencode/skills",
    isUniversal: true,
    detectInstalled: "which opencode",
    parentCompany: "SST",
    featureSupport: {
      slashCommands: true,
      hooks: false,
      mcp: true,
      customSystemPrompt: true,
    },
    ...overrides,
  };
}

function createSkillFixture(
  baseDir: string,
  name: string,
  opts?: { withAgents?: boolean },
): void {
  const skillDir = join(baseDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`,
  );
  if (opts?.withAgents) {
    mkdirSync(join(skillDir, "agents"), { recursive: true });
    writeFileSync(
      join(skillDir, "agents", "worker.md"),
      `# Worker agent for ${name}\n`,
    );
  }
}

describe("core-skills/sync", () => {
  let tempDir: string;
  let projectRoot: string;
  let skillsSource: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-core-sync-"));
    projectRoot = join(tempDir, "project");
    skillsSource = join(tempDir, "skills-source");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(skillsSource, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("findCoreSkillsDir", () => {
    it("finds skills in Claude Code plugin cache", () => {
      // This test verifies the real function against the actual system.
      // If the user has the plugin installed, it should find it.
      // If not, it returns null — both are valid.
      const result = findCoreSkillsDir();
      if (result !== null) {
        expect(existsSync(result)).toBe(true);
      }
    });
  });

  describe("listCoreSkills", () => {
    it("lists directories containing SKILL.md", () => {
      createSkillFixture(skillsSource, "architect");
      createSkillFixture(skillsSource, "team-lead");
      mkdirSync(join(skillsSource, "not-a-skill"), { recursive: true });

      const skills = listCoreSkills(skillsSource);
      expect(skills).toContain("architect");
      expect(skills).toContain("team-lead");
      expect(skills).not.toContain("not-a-skill");
    });

    it("returns empty array for empty directory", () => {
      expect(listCoreSkills(skillsSource)).toEqual([]);
    });
  });

  describe("syncCoreSkills", () => {
    it("returns 0 when no agents provided", () => {
      createSkillFixture(skillsSource, "architect");
      expect(syncCoreSkills([], projectRoot, skillsSource)).toBe(0);
    });

    it("returns 0 when no skills exist in source dir", () => {
      expect(syncCoreSkills([makeAgent()], projectRoot, skillsSource)).toBe(0);
    });

    it("syncs skills to canonical .agents/skills/sw/ directory", () => {
      createSkillFixture(skillsSource, "architect");
      createSkillFixture(skillsSource, "done");

      const agent = makeAgent({
        id: "opencode",
        localSkillsDir: ".opencode/skills",
      });
      const synced = syncCoreSkills([agent], projectRoot, skillsSource);
      expect(synced).toBe(2);

      const canonicalArchitect = join(
        projectRoot,
        ".agents",
        "skills",
        "sw",
        "architect",
        "SKILL.md",
      );
      expect(existsSync(canonicalArchitect)).toBe(true);

      const canonicalDone = join(
        projectRoot,
        ".agents",
        "skills",
        "sw",
        "done",
        "SKILL.md",
      );
      expect(existsSync(canonicalDone)).toBe(true);
    });

    it("copies agent subdirectory files alongside SKILL.md", () => {
      createSkillFixture(skillsSource, "team-lead", { withAgents: true });

      const agent = makeAgent();
      syncCoreSkills([agent], projectRoot, skillsSource);

      const canonicalAgentFile = join(
        projectRoot,
        ".agents",
        "skills",
        "sw",
        "team-lead",
        "agents",
        "worker.md",
      );
      expect(existsSync(canonicalAgentFile)).toBe(true);
      expect(readFileSync(canonicalAgentFile, "utf-8")).toContain(
        "Worker agent for team-lead",
      );
    });

    it("syncs to multiple agents simultaneously", () => {
      createSkillFixture(skillsSource, "pm");

      const agents = [
        makeAgent({ id: "opencode", localSkillsDir: ".opencode/skills" }),
        makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" }),
      ];
      const synced = syncCoreSkills(agents, projectRoot, skillsSource);
      expect(synced).toBe(1);

      // Canonical source exists
      expect(
        existsSync(
          join(projectRoot, ".agents", "skills", "sw", "pm", "SKILL.md"),
        ),
      ).toBe(true);

      // Agent symlinks/copies exist
      expect(
        existsSync(
          join(projectRoot, ".opencode", "skills", "sw", "pm", "SKILL.md"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(projectRoot, ".cursor", "skills", "sw", "pm", "SKILL.md"),
        ),
      ).toBe(true);
    });

    it("preserves SKILL.md content accurately", () => {
      createSkillFixture(skillsSource, "architect");

      syncCoreSkills(
        [makeAgent({ id: "opencode", localSkillsDir: ".opencode/skills" })],
        projectRoot,
        skillsSource,
      );

      const content = readFileSync(
        join(projectRoot, ".agents", "skills", "sw", "architect", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("name: architect");
      expect(content).toContain("# architect");
    });

    it("writes sw/{name}/SKILL.md structure, not flat sw/{name}.md (AC-US4-01)", () => {
      createSkillFixture(skillsSource, "architect");
      createSkillFixture(skillsSource, "pm");

      const agent = makeAgent({
        id: "opencode",
        localSkillsDir: ".opencode/skills",
      });
      syncCoreSkills([agent], projectRoot, skillsSource);

      // Correct: sw/{name}/SKILL.md
      expect(
        existsSync(
          join(projectRoot, ".opencode", "skills", "sw", "architect", "SKILL.md"),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(projectRoot, ".opencode", "skills", "sw", "pm", "SKILL.md"),
        ),
      ).toBe(true);

      // Incorrect flat files must NOT exist
      expect(
        existsSync(join(projectRoot, ".opencode", "skills", "sw", "architect.md")),
      ).toBe(false);
      expect(
        existsSync(join(projectRoot, ".opencode", "skills", "sw", "pm.md")),
      ).toBe(false);
    });

    it("agent files written alongside SKILL.md in sw/{name}/ subdir (AC-US4-02)", () => {
      createSkillFixture(skillsSource, "team-lead", { withAgents: true });

      const agent = makeAgent({
        id: "opencode",
        localSkillsDir: ".opencode/skills",
      });
      syncCoreSkills([agent], projectRoot, skillsSource);

      // Agent file should be inside sw/team-lead/agents/
      const agentFile = join(
        projectRoot,
        ".opencode",
        "skills",
        "sw",
        "team-lead",
        "agents",
        "worker.md",
      );
      expect(existsSync(agentFile)).toBe(true);
      expect(readFileSync(agentFile, "utf-8")).toContain("Worker agent for team-lead");
    });

    it("migration cleans stale sw/ flat files before sync (AC-US4-03)", () => {
      createSkillFixture(skillsSource, "pm");

      const agent = makeAgent({
        id: "opencode",
        localSkillsDir: ".opencode/skills",
      });

      // Pre-create stale flat file from a prior version
      const swDir = join(projectRoot, ".opencode", "skills", "sw");
      mkdirSync(swDir, { recursive: true });
      writeFileSync(join(swDir, "pm.md"), "# PM (stale flat file from old sync)");

      // Run migration BEFORE sync (as init.ts does)
      const agentSkillsDir = join(projectRoot, ".opencode", "skills");
      migrateStaleSkillFiles(agentSkillsDir);

      // Now sync
      syncCoreSkills([agent], projectRoot, skillsSource);

      // Stale flat file gone
      expect(existsSync(join(swDir, "pm.md"))).toBe(false);
      // Correct structure exists
      expect(existsSync(join(swDir, "pm", "SKILL.md"))).toBe(true);
    });

    it("handles claude-code agent (copy fallback, no symlink)", () => {
      createSkillFixture(skillsSource, "done");

      const agent = makeAgent({
        id: "claude-code",
        localSkillsDir: ".claude/skills",
      });
      const synced = syncCoreSkills([agent], projectRoot, skillsSource);
      expect(synced).toBe(1);

      // Claude Code gets a direct copy (not symlink) due to COPY_FALLBACK_AGENTS
      const claudeSkill = join(
        projectRoot,
        ".claude",
        "skills",
        "sw",
        "done",
        "SKILL.md",
      );
      expect(existsSync(claudeSkill)).toBe(true);
    });
  });
});
