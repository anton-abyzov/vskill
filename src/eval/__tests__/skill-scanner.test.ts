import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkills } from "../skill-scanner.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let testDir: string;

function createSkill(
  plugin: string,
  skill: string,
  opts: { evals?: boolean; benchmark?: boolean } = {},
): void {
  const skillDir = join(testDir, plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);

  if (opts.evals) {
    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(
      join(evalsDir, "evals.json"),
      JSON.stringify({ skill_name: skill, evals: [] }),
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
});
