import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyPluginFiltered, isSkillMdCandidate } from "./add.js";

// ---------------------------------------------------------------------------
// isSkillMdCandidate
// ---------------------------------------------------------------------------

describe("isSkillMdCandidate", () => {
  it("returns true for a regular .md skill file", () => {
    expect(isSkillMdCandidate("design.md", "skills/my-skill/design.md")).toBe(true);
  });

  it("returns false for SKILL.md (already canonical)", () => {
    expect(isSkillMdCandidate("SKILL.md", "skills/my-skill/SKILL.md")).toBe(false);
  });

  it("returns false for README.md (skip list)", () => {
    expect(isSkillMdCandidate("README.md", "README.md")).toBe(false);
  });

  it("returns false for PLUGIN.md (skip list)", () => {
    expect(isSkillMdCandidate("PLUGIN.md", "PLUGIN.md")).toBe(false);
  });

  it("returns false for files inside agents/ directory", () => {
    expect(isSkillMdCandidate("frontend.md", "agents/frontend.md")).toBe(false);
    expect(isSkillMdCandidate("planner.md", "skills/my-skill/agents/planner.md")).toBe(false);
  });

  it("returns false for files inside commands/ directory", () => {
    expect(isSkillMdCandidate("docs-build.md", "commands/docs-build.md")).toBe(false);
    expect(isSkillMdCandidate("archive.md", "commands/archive.md")).toBe(false);
  });

  it("returns false for non-.md files", () => {
    expect(isSkillMdCandidate("config.json", "config.json")).toBe(false);
    expect(isSkillMdCandidate("hook.sh", "hooks/hook.sh")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// copyPluginFiltered
// ---------------------------------------------------------------------------

describe("copyPluginFiltered", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-copy-filtered-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("multi-skill plugin (e.g., sw with ado-mapper, architect)", () => {
    it("creates {skill}/SKILL.md for each skill from flattened skills/ dir", () => {
      // Source: mimics sw plugin structure
      const sourceDir = join(tempDir, "source");
      mkdirSync(join(sourceDir, "skills", "ado-mapper"), { recursive: true });
      mkdirSync(join(sourceDir, "skills", "architect"), { recursive: true });
      writeFileSync(join(sourceDir, "skills", "ado-mapper", "SKILL.md"), "# ADO Mapper\nMaps items.");
      writeFileSync(join(sourceDir, "skills", "architect", "SKILL.md"), "# Architect\nDesigns systems.");

      const targetDir = join(tempDir, "target", "sw");
      copyPluginFiltered(sourceDir, targetDir);

      // Each skill should be in its own subdirectory with SKILL.md
      expect(existsSync(join(targetDir, "ado-mapper", "SKILL.md"))).toBe(true);
      expect(existsSync(join(targetDir, "architect", "SKILL.md"))).toBe(true);

      const adoContent = readFileSync(join(targetDir, "ado-mapper", "SKILL.md"), "utf-8");
      expect(adoContent).toContain("# ADO Mapper");

      const archContent = readFileSync(join(targetDir, "architect", "SKILL.md"), "utf-8");
      expect(archContent).toContain("# Architect");
    });

    it("does not create flat .md files for skills from flattened skills/ dir", () => {
      const sourceDir = join(tempDir, "source");
      mkdirSync(join(sourceDir, "skills", "pm"), { recursive: true });
      writeFileSync(join(sourceDir, "skills", "pm", "SKILL.md"), "# PM\nProject manager.");

      const targetDir = join(tempDir, "target", "sw");
      copyPluginFiltered(sourceDir, targetDir);

      // Should NOT have a flat pm.md file
      expect(existsSync(join(targetDir, "pm.md"))).toBe(false);
      // Should have the nested structure
      expect(existsSync(join(targetDir, "pm", "SKILL.md"))).toBe(true);
    });
  });

  describe("single-skill plugin where pluginName == skillName (e.g., frontend-design)", () => {
    it("prevents double-nesting: writes SKILL.md directly in target dir", () => {
      // Source: mimics frontend-design plugin structure
      const sourceDir = join(tempDir, "source");
      mkdirSync(join(sourceDir, "skills", "frontend-design"), { recursive: true });
      writeFileSync(
        join(sourceDir, "skills", "frontend-design", "SKILL.md"),
        "# Frontend Design\nDesign beautiful interfaces.",
      );
      writeFileSync(join(sourceDir, "README.md"), "# Plugin readme");

      // Target already includes the plugin name
      const targetDir = join(tempDir, "target", "frontend-design");
      copyPluginFiltered(sourceDir, targetDir);

      // SKILL.md should be directly in the target, NOT double-nested
      expect(existsSync(join(targetDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(targetDir, "frontend-design", "SKILL.md"))).toBe(false);

      const content = readFileSync(join(targetDir, "SKILL.md"), "utf-8");
      expect(content).toContain("# Frontend Design");
    });
  });

  describe("command files from flattened commands/ dir", () => {
    it("does not promote command .md files to SKILL.md", () => {
      const sourceDir = join(tempDir, "source");
      mkdirSync(join(sourceDir, "commands"), { recursive: true });
      mkdirSync(join(sourceDir, "skills", "pm"), { recursive: true });
      writeFileSync(join(sourceDir, "commands", "docs-build.md"), "# Docs Build Command");
      writeFileSync(join(sourceDir, "commands", "archive.md"), "# Archive Command");
      writeFileSync(join(sourceDir, "skills", "pm", "SKILL.md"), "# PM\nProject manager.");

      const targetDir = join(tempDir, "target", "sw");
      copyPluginFiltered(sourceDir, targetDir);

      // Command files should be copied as-is (not promoted to SKILL.md)
      expect(existsSync(join(targetDir, "docs-build.md"))).toBe(true);
      expect(existsSync(join(targetDir, "archive.md"))).toBe(true);
      // The skill should have proper SKILL.md
      expect(existsSync(join(targetDir, "pm", "SKILL.md"))).toBe(true);
      // Target root should NOT have a SKILL.md from promoted commands
      expect(existsSync(join(targetDir, "SKILL.md"))).toBe(false);
    });
  });

  describe("PLUGIN.md and other skip-list files", () => {
    it("skips PLUGIN.md (shouldSkipFromCommands filter)", () => {
      const sourceDir = join(tempDir, "source");
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, "PLUGIN.md"), "# Plugin definition");

      const targetDir = join(tempDir, "target");
      copyPluginFiltered(sourceDir, targetDir);

      expect(existsSync(join(targetDir, "PLUGIN.md"))).toBe(false);
    });
  });

  describe("agents/ directory files", () => {
    it("copies agents/*.md files as-is without promotion to SKILL.md", () => {
      const sourceDir = join(tempDir, "source");
      mkdirSync(join(sourceDir, "agents"), { recursive: true });
      writeFileSync(join(sourceDir, "agents", "planner.md"), "# Planner Agent");

      const targetDir = join(tempDir, "target");
      copyPluginFiltered(sourceDir, targetDir);

      // Agent files copied as-is, not promoted to SKILL.md
      expect(existsSync(join(targetDir, "agents", "planner.md"))).toBe(true);
      expect(existsSync(join(targetDir, "agents", "SKILL.md"))).toBe(false);
    });
  });
});
