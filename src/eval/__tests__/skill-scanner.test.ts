import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkills } from "../skill-scanner.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

/** Create a skill in direct plugin layout: {root}/{plugin}/skills/{skill}/ */
function createSkill(
  plugin: string,
  skill: string,
  opts: { evals?: boolean; benchmark?: boolean } = {},
): void {
  const skillDir = join(testDir, plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);
  addEvalFiles(skillDir, opts);
}

/** Create a skill in nested plugins/ layout: {root}/plugins/{plugin}/skills/{skill}/ */
function createNestedSkill(
  plugin: string,
  skill: string,
  opts: { evals?: boolean; benchmark?: boolean } = {},
): void {
  const skillDir = join(testDir, "plugins", plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);
  addEvalFiles(skillDir, opts);
}

/** Create a skill in root layout: {root}/skills/{skill}/ */
function createRootSkill(
  skill: string,
  opts: { evals?: boolean; benchmark?: boolean } = {},
): void {
  const skillDir = join(testDir, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);
  addEvalFiles(skillDir, opts);
}

function addEvalFiles(
  skillDir: string,
  opts: { evals?: boolean; benchmark?: boolean },
): void {
  if (opts.evals) {
    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(
      join(evalsDir, "evals.json"),
      JSON.stringify({ skill_name: "test", evals: [] }),
    );
  }

  if (opts.benchmark) {
    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(
      join(evalsDir, "benchmark.json"),
      JSON.stringify({ timestamp: "2026-03-01T00:00:00Z" }),
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scanSkills", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // --- Plugin layout (existing) ---

  it("discovers skills in plugins directory", async () => {
    createSkill("marketing", "social-media-posting");
    createSkill("devtools", "code-review");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.skill).sort();
    expect(names).toEqual(["code-review", "social-media-posting"]);
  });

  it("sets hasEvals=true when evals.json exists", async () => {
    createSkill("marketing", "social-media-posting", { evals: true });

    const skills = await scanSkills(testDir);

    expect(skills[0].hasEvals).toBe(true);
  });

  it("sets hasEvals=false when evals.json is absent", async () => {
    createSkill("marketing", "social-media-posting");

    const skills = await scanSkills(testDir);

    expect(skills[0].hasEvals).toBe(false);
  });

  it("sets hasBenchmark=true when benchmark.json exists", async () => {
    createSkill("marketing", "social-media-posting", {
      evals: true,
      benchmark: true,
    });

    const skills = await scanSkills(testDir);

    expect(skills[0].hasBenchmark).toBe(true);
  });

  it("sets hasBenchmark=false when benchmark.json is absent", async () => {
    createSkill("marketing", "social-media-posting", { evals: true });

    const skills = await scanSkills(testDir);

    expect(skills[0].hasBenchmark).toBe(false);
  });

  it("returns correct plugin and skill names", async () => {
    createSkill("marketing", "social-media-posting");

    const skills = await scanSkills(testDir);

    expect(skills[0].plugin).toBe("marketing");
    expect(skills[0].skill).toBe("social-media-posting");
  });

  it("returns empty array for empty root", async () => {
    const skills = await scanSkills(testDir);
    expect(skills).toEqual([]);
  });

  // --- Root layout (new) ---

  it("discovers root-level skills in skills/ directory", async () => {
    createRootSkill("my-skill");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].skill).toBe("my-skill");
  });

  it("uses root dirname as plugin name for root-level skills", async () => {
    createRootSkill("my-skill");

    const skills = await scanSkills(testDir);

    // plugin name = basename of the root dir
    expect(skills[0].plugin).toBe(testDir.split("/").pop());
  });

  it("discovers both plugin and root-level skills together", async () => {
    createSkill("marketing", "social-media-posting");
    createRootSkill("standalone-skill");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.skill).sort();
    expect(names).toEqual(["social-media-posting", "standalone-skill"]);
  });

  it("handles root-level skills with evals", async () => {
    createRootSkill("my-skill", { evals: true, benchmark: true });

    const skills = await scanSkills(testDir);

    expect(skills[0].hasEvals).toBe(true);
    expect(skills[0].hasBenchmark).toBe(true);
  });

  // --- Nested plugins/ layout ---

  it("discovers skills inside plugins/ subdirectory", async () => {
    createNestedSkill("marketing", "social-media-posting");
    createNestedSkill("mobile", "appstore");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.skill).sort();
    expect(names).toEqual(["appstore", "social-media-posting"]);
  });

  it("discovers skills across all three layouts", async () => {
    createRootSkill("root-skill");
    createSkill("direct-plugin", "direct-skill");
    createNestedSkill("nested-plugin", "nested-skill");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(3);
    const names = skills.map((s) => s.skill).sort();
    expect(names).toEqual(["direct-skill", "nested-skill", "root-skill"]);
  });

  it("nested plugins/ skills have correct plugin names", async () => {
    createNestedSkill("marketing", "smp");

    const skills = await scanSkills(testDir);

    expect(skills[0].plugin).toBe("marketing");
    expect(skills[0].skill).toBe("smp");
  });

  // --- Self layout (root IS the skill dir) ---

  it("discovers skill when root points directly at a skill directory", async () => {
    const skillDir = join(testDir, "my-plugin", "skills", "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# my-skill");
    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(
      join(evalsDir, "evals.json"),
      JSON.stringify({ skill_name: "my-skill", evals: [] }),
    );

    const skills = await scanSkills(skillDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].skill).toBe("my-skill");
    // Parent of "skills" dir is "my-plugin" — scanner walks up past "skills" to find plugin name
    expect(skills[0].plugin).toBe("my-plugin");
    expect(skills[0].hasEvals).toBe(true);
    expect(skills[0].dir).toBe(skillDir);
  });

  it("uses parent directory name as plugin for self layout", async () => {
    const skillDir = join(testDir, "social-media-posting");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# smp");

    const skills = await scanSkills(skillDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].plugin).toBe(testDir.split("/").pop());
    expect(skills[0].skill).toBe("social-media-posting");
  });

  it("allows 'skills' as a plugin name inside plugins/ directory", async () => {
    createNestedSkill("skills", "scout");

    const skills = await scanSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].plugin).toBe("skills");
    expect(skills[0].skill).toBe("scout");
  });
});
