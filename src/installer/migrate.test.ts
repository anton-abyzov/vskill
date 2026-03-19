import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateStaleSkillFiles, ensureSkillMdNaming, cleanStaleNesting } from "./migrate.js";

describe("migrateStaleSkillFiles", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-migrate-"));
    skillsDir = join(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // T-002: Core migration scenarios (AC-US1-01 through AC-US1-04)
  // -----------------------------------------------------------------------

  describe("flat file migration (AC-US1-01)", () => {
    it("moves {name}.md to {name}/SKILL.md", () => {
      writeFileSync(
        join(skillsDir, "frontend-design.md"),
        "# Frontend Design\n\nA skill for frontend design.",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      // Flat file should be gone
      expect(existsSync(join(skillsDir, "frontend-design.md"))).toBe(false);
      // SKILL.md should exist in subdirectory
      expect(
        existsSync(join(skillsDir, "frontend-design", "SKILL.md")),
      ).toBe(true);
      // Content should be preserved
      const content = readFileSync(
        join(skillsDir, "frontend-design", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("# Frontend Design");
      expect(result.migratedCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("migrates multiple flat files in one pass", () => {
      writeFileSync(join(skillsDir, "skill-a.md"), "# Skill A");
      writeFileSync(join(skillsDir, "skill-b.md"), "# Skill B");
      writeFileSync(join(skillsDir, "skill-c.md"), "# Skill C");

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(3);
      expect(existsSync(join(skillsDir, "skill-a", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillsDir, "skill-b", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillsDir, "skill-c", "SKILL.md"))).toBe(true);
    });
  });

  describe("idempotent on correct structure (AC-US1-02)", () => {
    it("leaves existing {name}/SKILL.md untouched", () => {
      const skillDir = join(skillsDir, "my-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: my-skill\ndescription: existing\n---\n# My Skill",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(0);
      expect(result.removedCount).toBe(0);
      // Content unchanged
      const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
      expect(content).toContain("name: my-skill");
    });
  });

  describe("nested sw/ path migration (AC-US1-03)", () => {
    it("migrates sw/ado-mapper.md to sw/ado-mapper/SKILL.md", () => {
      const swDir = join(skillsDir, "sw");
      mkdirSync(swDir, { recursive: true });
      writeFileSync(
        join(swDir, "ado-mapper.md"),
        "# ADO Mapper\n\nMaps Azure DevOps work items.",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      expect(existsSync(join(swDir, "ado-mapper.md"))).toBe(false);
      expect(existsSync(join(swDir, "ado-mapper", "SKILL.md"))).toBe(true);
      const content = readFileSync(
        join(swDir, "ado-mapper", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("# ADO Mapper");
      expect(result.migratedCount).toBe(1);
    });

    it("migrates multiple sw/ flat files", () => {
      const swDir = join(skillsDir, "sw");
      mkdirSync(swDir, { recursive: true });
      writeFileSync(join(swDir, "pm.md"), "# PM");
      writeFileSync(join(swDir, "architect.md"), "# Architect");

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(2);
      expect(existsSync(join(swDir, "pm", "SKILL.md"))).toBe(true);
      expect(existsSync(join(swDir, "architect", "SKILL.md"))).toBe(true);
    });
  });

  describe("both flat file and SKILL.md coexist (AC-US1-04)", () => {
    it("removes flat file when {name}/SKILL.md already exists", () => {
      // Create both: flat file AND correct subdir
      writeFileSync(
        join(skillsDir, "pm.md"),
        "# PM (stale flat file)",
      );
      const pmDir = join(skillsDir, "pm");
      mkdirSync(pmDir, { recursive: true });
      writeFileSync(
        join(pmDir, "SKILL.md"),
        "---\nname: pm\ndescription: Project manager\n---\n# PM (correct)",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      // Flat file removed
      expect(existsSync(join(skillsDir, "pm.md"))).toBe(false);
      // Existing SKILL.md preserved with original content
      const content = readFileSync(join(pmDir, "SKILL.md"), "utf-8");
      expect(content).toContain("# PM (correct)");
      expect(result.removedCount).toBe(1);
      expect(result.migratedCount).toBe(0);
    });

    it("handles both-exist in nested sw/ directory", () => {
      const swDir = join(skillsDir, "sw");
      mkdirSync(swDir, { recursive: true });
      writeFileSync(join(swDir, "done.md"), "# Done (stale)");
      const doneDir = join(swDir, "done");
      mkdirSync(doneDir, { recursive: true });
      writeFileSync(
        join(doneDir, "SKILL.md"),
        "---\nname: done\ndescription: Done skill\n---\n# Done (correct)",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      expect(existsSync(join(swDir, "done.md"))).toBe(false);
      const content = readFileSync(join(doneDir, "SKILL.md"), "utf-8");
      expect(content).toContain("# Done (correct)");
      expect(result.removedCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // T-005: Frontmatter injection during migration (AC-US2-01, AC-US2-02, AC-US2-03)
  // -----------------------------------------------------------------------

  describe("frontmatter injection during migration", () => {
    it("adds name and description frontmatter to migrated file without frontmatter (AC-US2-01, AC-US2-02)", () => {
      writeFileSync(
        join(skillsDir, "frontend-design.md"),
        "# Frontend Design\n\nDesign beautiful frontend interfaces.",
      );

      migrateStaleSkillFiles(skillsDir);

      const content = readFileSync(
        join(skillsDir, "frontend-design", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("name: frontend-design");
      expect(content).toContain("description:");
      expect(content).toContain("Design beautiful frontend interfaces");
    });

    it("preserves existing valid frontmatter during migration (AC-US2-03)", () => {
      writeFileSync(
        join(skillsDir, "my-tool.md"),
        "---\nname: my-tool\ndescription: An existing tool\n---\n# My Tool\n\nDoes things.",
      );

      migrateStaleSkillFiles(skillsDir);

      const content = readFileSync(
        join(skillsDir, "my-tool", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("name: my-tool");
      expect(content).toContain("description: An existing tool");
    });

    it("injects missing name into file with partial frontmatter", () => {
      writeFileSync(
        join(skillsDir, "partial.md"),
        "---\ndescription: Has description only\n---\n# Partial",
      );

      migrateStaleSkillFiles(skillsDir);

      const content = readFileSync(
        join(skillsDir, "partial", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("name: partial");
      expect(content).toContain("description: Has description only");
    });

    it("injects description from body when missing in frontmatter", () => {
      writeFileSync(
        join(skillsDir, "no-desc.md"),
        "---\nname: no-desc\n---\n# Title\n\nFirst paragraph is used.",
      );

      migrateStaleSkillFiles(skillsDir);

      const content = readFileSync(
        join(skillsDir, "no-desc", "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain("name: no-desc");
      expect(content).toContain("description: First paragraph is used.");
    });
  });

  // -----------------------------------------------------------------------
  // T-015: Edge case tests
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("skips symlinked .md files", () => {
      // Create a real file somewhere else and symlink it
      const realFile = join(tempDir, "real-skill.md");
      writeFileSync(realFile, "# Real Skill");
      symlinkSync(realFile, join(skillsDir, "linked-skill.md"));

      const result = migrateStaleSkillFiles(skillsDir);

      // Symlink should be untouched
      expect(lstatSync(join(skillsDir, "linked-skill.md")).isSymbolicLink()).toBe(true);
      expect(result.migratedCount).toBe(0);
      expect(result.removedCount).toBe(0);
    });

    it("skips symlinked directories", () => {
      // Create a real directory and symlink it
      const realDir = join(tempDir, "real-skill-dir");
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, "SKILL.md"), "# Real");
      symlinkSync(realDir, join(skillsDir, "linked-dir"));

      const result = migrateStaleSkillFiles(skillsDir);

      expect(lstatSync(join(skillsDir, "linked-dir")).isSymbolicLink()).toBe(true);
      expect(result.migratedCount).toBe(0);
    });

    it("handles empty (0-byte) .md file — produces frontmatter-only SKILL.md", () => {
      writeFileSync(join(skillsDir, "empty.md"), "");

      migrateStaleSkillFiles(skillsDir);

      expect(existsSync(join(skillsDir, "empty", "SKILL.md"))).toBe(true);
      const content = readFileSync(
        join(skillsDir, "empty", "SKILL.md"),
        "utf-8",
      );
      // Should have frontmatter with name
      expect(content).toContain("name: empty");
      expect(content).toContain("description:");
    });

    it("skips non-.md files", () => {
      writeFileSync(join(skillsDir, "readme.txt"), "not a skill");
      writeFileSync(join(skillsDir, "config.json"), "{}");

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(0);
      expect(existsSync(join(skillsDir, "readme.txt"))).toBe(true);
      expect(existsSync(join(skillsDir, "config.json"))).toBe(true);
    });

    it("skips SKILL.md files at root level (not stale)", () => {
      // A SKILL.md directly in skillsDir is not a stale named file
      writeFileSync(join(skillsDir, "SKILL.md"), "# Root skill");

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(0);
      expect(existsSync(join(skillsDir, "SKILL.md"))).toBe(true);
    });

    it("handles non-existent skills directory gracefully", () => {
      const nonExistent = join(tempDir, "does-not-exist");
      const result = migrateStaleSkillFiles(nonExistent);

      expect(result.migratedCount).toBe(0);
      expect(result.removedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("returns accurate counts for mixed scenarios", () => {
      // 2 flat files to migrate
      writeFileSync(join(skillsDir, "skill-a.md"), "# A");
      writeFileSync(join(skillsDir, "skill-b.md"), "# B");

      // 1 both-exist (flat file to remove)
      writeFileSync(join(skillsDir, "skill-c.md"), "# C (stale)");
      mkdirSync(join(skillsDir, "skill-c"), { recursive: true });
      writeFileSync(
        join(skillsDir, "skill-c", "SKILL.md"),
        "# C (correct)",
      );

      // 1 correct structure (no-op)
      mkdirSync(join(skillsDir, "skill-d"), { recursive: true });
      writeFileSync(
        join(skillsDir, "skill-d", "SKILL.md"),
        "# D (correct)",
      );

      const result = migrateStaleSkillFiles(skillsDir);

      expect(result.migratedCount).toBe(2);
      expect(result.removedCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // T-011: Coverage of flat-file migration path
  // -----------------------------------------------------------------------

  describe("coverage: migration creates subdirectory structure", () => {
    it("creates the subdirectory if it does not exist", () => {
      writeFileSync(join(skillsDir, "new-skill.md"), "# New Skill\n\nContent.");

      migrateStaleSkillFiles(skillsDir);

      expect(lstatSync(join(skillsDir, "new-skill")).isDirectory()).toBe(true);
      expect(existsSync(join(skillsDir, "new-skill", "SKILL.md"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // T-014: Integration test — simulates init flow (migrate then verify)
  // -----------------------------------------------------------------------

  describe("integration: init-like flow with stale files", () => {
    it("cleans up stale files across multiple agent directories", () => {
      // Simulate two agents with their own skill dirs
      const opencodeSkills = join(tempDir, ".opencode", "skills");
      const cursorSkills = join(tempDir, ".cursor", "skills");
      mkdirSync(opencodeSkills, { recursive: true });
      mkdirSync(cursorSkills, { recursive: true });

      // Stale files in opencode
      writeFileSync(join(opencodeSkills, "architect.md"), "# Architect");
      const swDir = join(opencodeSkills, "sw");
      mkdirSync(swDir, { recursive: true });
      writeFileSync(join(swDir, "pm.md"), "# PM");

      // Stale files in cursor
      writeFileSync(join(cursorSkills, "frontend-design.md"), "# Frontend");

      // Run migration for each agent (as init.ts does)
      const r1 = migrateStaleSkillFiles(opencodeSkills);
      const r2 = migrateStaleSkillFiles(cursorSkills);

      // opencode: architect.md migrated, sw/pm.md migrated
      expect(r1.migratedCount).toBe(2);
      expect(existsSync(join(opencodeSkills, "architect", "SKILL.md"))).toBe(true);
      expect(existsSync(join(swDir, "pm", "SKILL.md"))).toBe(true);
      expect(existsSync(join(opencodeSkills, "architect.md"))).toBe(false);
      expect(existsSync(join(swDir, "pm.md"))).toBe(false);

      // cursor: frontend-design.md migrated
      expect(r2.migratedCount).toBe(1);
      expect(existsSync(join(cursorSkills, "frontend-design", "SKILL.md"))).toBe(true);
      expect(existsSync(join(cursorSkills, "frontend-design.md"))).toBe(false);

      // All migrated files have frontmatter
      const content = readFileSync(join(opencodeSkills, "architect", "SKILL.md"), "utf-8");
      expect(content).toContain("name: architect");
    });
  });
});

// =========================================================================
// ensureSkillMdNaming — post-install enforcement
// =========================================================================

describe("ensureSkillMdNaming", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-naming-"));
    skillsDir = join(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("renames lone .md file to SKILL.md with frontmatter (AC-US4-01)", () => {
    const skillDir = join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "design.md"), "# Design\n\nA design skill.");

    const result = ensureSkillMdNaming(skillsDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "design.md"))).toBe(false);
    const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: my-skill");
    expect(content).toContain("description:");
    expect(result.renamedCount).toBe(1);
  });

  it("is idempotent — no-op when SKILL.md already exists (AC-US4-02)", () => {
    const skillDir = join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: existing\n---\n# My Skill",
    );

    const result = ensureSkillMdNaming(skillsDir);

    expect(result.renamedCount).toBe(0);
    const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: my-skill");
  });

  it("skips README.md and renames the non-skip file (AC-US4-03)", () => {
    const skillDir = join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "README.md"), "# Readme");
    writeFileSync(join(skillDir, "guide.md"), "# Guide\n\nA guide.");

    const result = ensureSkillMdNaming(skillsDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "README.md"))).toBe(true); // preserved
    expect(existsSync(join(skillDir, "guide.md"))).toBe(false); // renamed
    expect(result.renamedCount).toBe(1);
  });

  it("picks alphabetically first candidate when multiple exist (AC-US4-04)", () => {
    const skillDir = join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "beta.md"), "# Beta");
    writeFileSync(join(skillDir, "alpha.md"), "# Alpha\n\nAlpha skill.");

    const result = ensureSkillMdNaming(skillsDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    const content = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("# Alpha"); // alpha.md was picked (first alphabetically)
    expect(existsSync(join(skillDir, "alpha.md"))).toBe(false);
    expect(existsSync(join(skillDir, "beta.md"))).toBe(false); // duplicate removed
    expect(result.renamedCount).toBe(1);
  });

  it("skips directory with only README.md — no candidates", () => {
    const skillDir = join(skillsDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "README.md"), "# Readme");

    const result = ensureSkillMdNaming(skillsDir);

    expect(result.renamedCount).toBe(0);
    expect(existsSync(join(skillDir, "README.md"))).toBe(true);
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(false);
  });

  it("handles empty skill directory gracefully", () => {
    const skillDir = join(skillsDir, "empty-skill");
    mkdirSync(skillDir, { recursive: true });

    const result = ensureSkillMdNaming(skillsDir);

    expect(result.renamedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles non-existent skillsDir gracefully", () => {
    const result = ensureSkillMdNaming(join(tempDir, "nonexistent"));

    expect(result.renamedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("enforces naming in nested namespace dirs (sw/)", () => {
    const swDir = join(skillsDir, "sw");
    const skillDir = join(swDir, "architect");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "architect.md"), "# Architect\n\nArchitect skill.");

    const result = ensureSkillMdNaming(skillsDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "architect.md"))).toBe(false);
    expect(result.renamedCount).toBe(1);
  });
});

// =========================================================================
// cleanStaleNesting — remove double-nested artifacts from pre-fix installs
// =========================================================================

describe("cleanStaleNesting", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vskill-nesting-"));
    skillsDir = join(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes stale nested dir when parent has SKILL.md", () => {
    const skillDir = join(skillsDir, "nanobanana");
    const nestedDir = join(skillDir, "nanobanana");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Correct");
    writeFileSync(join(nestedDir, "SKILL.md"), "# Stale");

    cleanStaleNesting(skillDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(nestedDir)).toBe(false);
  });

  it("does NOT remove nested dir when parent has no SKILL.md", () => {
    const skillDir = join(skillsDir, "myskill");
    const nestedDir = join(skillDir, "myskill");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, "SKILL.md"), "# Only copy");

    cleanStaleNesting(skillDir);

    // Nested dir should survive — it's the only copy
    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(join(nestedDir, "SKILL.md"))).toBe(true);
  });

  it("is a no-op when no nested dir exists", () => {
    const skillDir = join(skillsDir, "clean");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Clean");

    cleanStaleNesting(skillDir);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("skips symlinked nested dir", () => {
    const skillDir = join(skillsDir, "linked");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Correct");

    const realDir = join(tempDir, "real-linked");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "SKILL.md"), "# Real");
    symlinkSync(realDir, join(skillDir, "linked"));

    cleanStaleNesting(skillDir);

    // Symlinked nested dir should survive
    expect(lstatSync(join(skillDir, "linked")).isSymbolicLink()).toBe(true);
  });

  it("handles non-existent skillDir gracefully", () => {
    // Should not throw
    cleanStaleNesting(join(tempDir, "does-not-exist"));
  });
});
