// 0932 T-05 (AC-08): older plugin installs wrote `<namespace>/<name>` into the
// frontmatter (marketing/apify-data-gathering). Codex ignores that form, so
// doctor reports it; the skill part is still compared with the folder name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor, type DoctorIssue } from "../doctor.js";
import { isValidNamespacedSkillName, splitSkillName } from "../../installer/frontmatter.js";

let home: string;
let cwd: string;
let prevAgEnv: string | undefined;

function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Does a thing. Use when testing.\n---\n\n# Body\n`);
}

function link(target: string, at: string): void {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at, "dir");
}

const g = (...p: string[]) => join(home, ...p);
const ofKind = (issues: DoctorIssue[], kind: DoctorIssue["kind"]) => issues.filter((i) => i.kind === kind);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vskill-doctor-ns-home-"));
  cwd = mkdtempSync(join(tmpdir(), "vskill-doctor-ns-proj-"));
  prevAgEnv = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
  delete process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
});

afterEach(() => {
  if (prevAgEnv !== undefined) process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR = prevAgEnv;
  for (const d of [home, cwd]) rmSync(d, { recursive: true, force: true });
  process.exitCode = 0;
});

describe("AC-08: doctor reads <namespace>/<name> frontmatter names", () => {
  it("warns that Codex ignores marketing/apify-data-gathering, without a name-mismatch", () => {
    writeSkill(g(".agents/skills/apify-data-gathering"), "marketing/apify-data-gathering");
    link("../../.agents/skills/apify-data-gathering", g(".claude/skills/apify-data-gathering"));
    const report = runDoctor({ home, cwd, global: true });
    const bad = ofKind(report.issues, "bad-name");
    expect(bad.map((i) => i.skill)).toEqual(["apify-data-gathering"]);
    expect(bad[0].message).toContain("Codex ignores it");
    expect(bad[0].message).toContain("name: apify-data-gathering");
    expect(ofKind(report.issues, "name-mismatch")).toEqual([]);
  });

  it("still flags a namespaced name whose skill part differs from the folder", () => {
    writeSkill(g(".agents/skills/apify"), "marketing/apify-data-gathering");
    const mismatch = ofKind(runDoctor({ home, cwd, global: true }).issues, "name-mismatch");
    expect(mismatch.map((i) => i.skill)).toEqual(["apify"]);
  });

  it("still flags invalid parts and deeper nesting as bad-name", () => {
    writeSkill(g(".agents/skills/x"), "Marketing/x");
    writeSkill(g(".agents/skills/y"), "a/b/y");
    const bad = ofKind(runDoctor({ home, cwd, global: true }).issues, "bad-name");
    expect(bad.map((i) => i.skill).sort()).toEqual(["x", "y"]);
  });
});

describe("splitSkillName / isValidNamespacedSkillName", () => {
  it("splits on the first slash", () => {
    expect(splitSkillName("marketing/apify-data-gathering")).toEqual({ namespace: "marketing", name: "apify-data-gathering" });
    expect(splitSkillName("sw-do")).toEqual({ namespace: null, name: "sw-do" });
  });

  it("validates each part", () => {
    expect(isValidNamespacedSkillName("marketing/apify-data-gathering")).toBe(true);
    expect(isValidNamespacedSkillName("sw-do")).toBe(true);
    expect(isValidNamespacedSkillName("Marketing/x")).toBe(false);
    expect(isValidNamespacedSkillName("/x")).toBe(false);
    expect(isValidNamespacedSkillName("a/")).toBe(false);
  });
});
