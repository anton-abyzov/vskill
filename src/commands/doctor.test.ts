// 0894 T-04 (AC-05): vskill doctor — every test runs against a temp HOME and
// a temp project dir; nothing touches the real home directory.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { doctorCommand, parseSkillFrontmatter, runDoctor, type DoctorIssue } from "./doctor.js";

let home: string;
let cwd: string;
let outside: string;
let prevAgEnv: string | undefined;

function writeSkill(
  dir: string,
  opts: { name?: string | null; description?: string | null; body?: string; extra?: Record<string, string> } = {},
): string {
  mkdirSync(dir, { recursive: true });
  const name = opts.name === undefined ? dir.split("/").pop()! : opts.name;
  const description = opts.description === undefined ? "Does a thing. Use when testing." : opts.description;
  const fm = [name !== null ? `name: ${name}` : null, description !== null ? `description: ${description}` : null]
    .filter(Boolean)
    .join("\n");
  writeFileSync(join(dir, "SKILL.md"), `---\n${fm}\n---\n\n${opts.body ?? "# Body\n"}`);
  for (const [rel, content] of Object.entries(opts.extra ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

function link(target: string, at: string): string {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at, "dir");
  return at;
}

const g = (...p: string[]) => join(home, ...p);
const proj = (...p: string[]) => join(cwd, ...p);
const kinds = (issues: DoctorIssue[]) => issues.map((i) => i.kind).sort();
const ofKind = (issues: DoctorIssue[], kind: DoctorIssue["kind"]) => issues.filter((i) => i.kind === kind);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vskill-doctor-home-"));
  cwd = mkdtempSync(join(tmpdir(), "vskill-doctor-proj-"));
  outside = mkdtempSync(join(tmpdir(), "vskill-doctor-outside-"));
  prevAgEnv = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
  delete process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
});

afterEach(() => {
  if (prevAgEnv !== undefined) process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR = prevAgEnv;
  for (const d of [home, cwd, outside]) rmSync(d, { recursive: true, force: true });
  process.exitCode = 0;
});

describe("vskill doctor — clean state", () => {
  it("reports nothing for one canonical folder linked into Claude", () => {
    writeSkill(g(".agents/skills/foo"));
    link("../../.agents/skills/foo", g(".claude/skills/foo"));

    const report = runDoctor({ home, cwd });
    expect(report.issues).toEqual([]);
    expect(report.remaining).toBe(0);
    expect(report.scopes).toEqual(["global", "project"]);
    const shared = report.scanned.find((d) => d.dir === g(".agents/skills"));
    expect(shared?.readers).toEqual(expect.arrayContaining(["codex", "cursor", "grok", "opencode"]));
    expect(shared?.readers).not.toContain("claude-code");
  });
});

describe("vskill doctor — same name, real folders", () => {
  it("divergent copies are reported and --fix never touches them", () => {
    writeSkill(g(".agents/skills/foo"), { body: "codex edit\n" });
    writeSkill(g(".claude/skills/foo"), { body: "claude edit\n" });

    const report = runDoctor({ home, cwd, fix: true });
    const div = ofKind(report.issues, "divergent");
    expect(div).toHaveLength(1);
    expect(div[0].severity).toBe("error");
    expect(div[0].fixable).toBe(false);
    expect(div[0].paths.sort()).toEqual([g(".agents/skills/foo"), g(".claude/skills/foo")].sort());
    expect(report.fixes).toEqual([]);
    expect(lstatSync(g(".claude/skills/foo")).isSymbolicLink()).toBe(false);
    expect(readFileSync(g(".claude/skills/foo/SKILL.md"), "utf8")).toContain("claude edit");
    expect(readFileSync(g(".agents/skills/foo/SKILL.md"), "utf8")).toContain("codex edit");
    expect(report.remaining).toBe(1);
  });

  it("byte-identical copies (ignoring .DS_Store) are fixable; --fix links the copy to the shared one", () => {
    writeSkill(g(".agents/skills/foo"), { extra: { "scripts/run.sh": "echo hi\n" } });
    writeSkill(g(".claude/skills/foo"), { extra: { "scripts/run.sh": "echo hi\n", ".DS_Store": "junk" } });

    const before = runDoctor({ home, cwd });
    const ident = ofKind(before.issues, "identical-copy");
    expect(ident).toHaveLength(1);
    expect(ident[0].fixable).toBe(true);
    expect(ident[0].paths[0]).toBe(g(".agents/skills/foo"));

    const after = runDoctor({ home, cwd, fix: true });
    expect(after.fixes).toEqual([
      expect.objectContaining({ kind: "identical-copy", action: "replace-with-link", path: g(".claude/skills/foo"), ok: true }),
    ]);
    expect(lstatSync(g(".claude/skills/foo")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(g(".claude/skills/foo"))).toBe("../../.agents/skills/foo");
    expect(readFileSync(g(".claude/skills/foo/scripts/run.sh"), "utf8")).toBe("echo hi\n");
    expect(after.issues).toEqual([]);
    expect(after.remaining).toBe(0);
  });

  it("a fixed copy that becomes a redundant link is removed in the same run", () => {
    writeSkill(g(".agents/skills/foo"));
    writeSkill(g(".cursor/skills/foo"));

    const report = runDoctor({ home, cwd, fix: true });
    expect(report.fixes.map((f) => [f.kind, f.ok])).toEqual([
      ["identical-copy", true],
      ["redundant-link", true],
    ]);
    expect(existsSync(g(".cursor/skills/foo"))).toBe(false);
    expect(existsSync(g(".agents/skills/foo/SKILL.md"))).toBe(true);
    expect(report.remaining).toBe(0);
  });

  it("identical copies are left alone on Windows", () => {
    writeSkill(g(".agents/skills/foo"));
    writeSkill(g(".claude/skills/foo"));

    const report = runDoctor({ home, cwd, fix: true, platform: "win32" });
    expect(ofKind(report.issues, "identical-copy")[0].fixable).toBe(false);
    expect(report.fixes).toEqual([]);
    expect(lstatSync(g(".claude/skills/foo")).isDirectory()).toBe(true);
  });

  it("identical copies with no copy in the shared folder are report-only", () => {
    writeSkill(g(".claude/skills/foo"));
    writeSkill(g(".cursor/skills/foo"));

    const report = runDoctor({ home, cwd, fix: true });
    const ident = ofKind(report.issues, "identical-copy");
    expect(ident).toHaveLength(1);
    expect(ident[0].fixable).toBe(false);
    expect(report.fixes).toEqual([]);
  });
});

describe("vskill doctor — links", () => {
  it("broken links are fixable and removed", () => {
    link(join(outside, "gone"), g(".gemini/antigravity/skills/find-skills"));

    const before = runDoctor({ home, cwd });
    expect(kinds(before.issues)).toEqual(["broken-link"]);
    expect(before.issues[0].paths).toEqual([g(".gemini/antigravity/skills/find-skills")]);

    const after = runDoctor({ home, cwd, fix: true });
    expect(after.fixes).toEqual([
      expect.objectContaining({ kind: "broken-link", action: "remove-link", ok: true }),
    ]);
    expect(existsSync(g(".gemini/antigravity/skills/find-skills"))).toBe(false);
    expect(after.remaining).toBe(0);
  });

  it("links in agent folders whose agent already reads ~/.agents/skills are redundant", () => {
    writeSkill(g(".agents/skills/foo"));
    link("../../.agents/skills/foo", g(".cursor/skills/foo"));
    link("../../../.agents/skills/foo", g(".config/opencode/skills/foo"));
    link("../../.agents/skills/foo", g(".grok/skills/foo"));
    link("../../.agents/skills/foo", g(".gemini/skills/foo"));
    link("../../.agents/skills/foo", g(".claude/skills/foo"));
    link("../../../.agents/skills/foo", g(".gemini/antigravity/skills/foo"));

    const report = runDoctor({ home, cwd });
    const redundant = ofKind(report.issues, "redundant-link");
    expect(redundant.map((i) => i.paths[0]).sort()).toEqual(
      [g(".cursor/skills/foo"), g(".config/opencode/skills/foo"), g(".grok/skills/foo"), g(".gemini/skills/foo")].sort(),
    );
    expect(redundant.find((i) => i.paths[0] === g(".cursor/skills/foo"))?.agents).toEqual(["cursor"]);
    // Claude and Antigravity (global) do not read ~/.agents/skills: their links stay.
    expect(report.issues.every((i) => !i.paths.includes(g(".claude/skills/foo")))).toBe(true);
    expect(report.issues.every((i) => !i.paths.includes(g(".gemini/antigravity/skills/foo")))).toBe(true);

    const fixed = runDoctor({ home, cwd, fix: true });
    expect(fixed.fixes.filter((f) => f.ok)).toHaveLength(4);
    expect(lstatSync(g(".claude/skills/foo")).isSymbolicLink()).toBe(true);
    expect(lstatSync(g(".gemini/antigravity/skills/foo")).isSymbolicLink()).toBe(true);
    expect(fixed.remaining).toBe(0);
  });

  it("a link Cursor also sees through ~/.claude/skills is redundant", () => {
    writeSkill(join(outside, "bar"));
    link(join(outside, "bar"), g(".claude/skills/bar"));
    link(join(outside, "bar"), g(".cursor/skills/bar"));

    const report = runDoctor({ home, cwd });
    expect(ofKind(report.issues, "redundant-link").map((i) => i.paths[0])).toEqual([g(".cursor/skills/bar")]);
  });

  it("a link is kept when any reader of its folder has no other route (~/.copilot/skills)", () => {
    writeSkill(g(".agents/skills/foo"));
    link("../../.agents/skills/foo", g(".copilot/skills/foo"));

    const report = runDoctor({ home, cwd });
    // copilot-cli reads ~/.agents/skills, but the VS Code extension entry
    // documents only ~/.copilot/skills — removing the link could hide it.
    expect(ofKind(report.issues, "redundant-link")).toEqual([]);
  });

  it("two links that only cover each other are never both removed", () => {
    writeSkill(join(outside, "baz"));
    link(join(outside, "baz"), g(".cursor/skills/baz"));
    link(join(outside, "baz"), g(".codex/skills/baz"));

    const report = runDoctor({ home, cwd, fix: true });
    expect(report.fixes.filter((f) => f.kind === "redundant-link" && f.ok)).toHaveLength(1);
    const survivors = [g(".cursor/skills/baz"), g(".codex/skills/baz")].filter((p) => existsSync(p));
    expect(survivors).toHaveLength(1);
    expect(report.remaining).toBe(0);
  });
});

describe("vskill doctor — SKILL.md content checks", () => {
  it("reports migrate-to-codex damage without fixing it", () => {
    writeSkill(g(".agents/skills/foo"), { body: "Run .Codex/hooks\n\n## MANUAL MIGRATION REQUIRED\n" });

    const report = runDoctor({ home, cwd, fix: true });
    const dmg = ofKind(report.issues, "migration-damage");
    expect(dmg).toHaveLength(1);
    expect(dmg[0].fixable).toBe(false);
    expect(dmg[0].message).toContain("MANUAL MIGRATION REQUIRED");
    expect(dmg[0].message).toContain(".Codex/");
    expect(report.fixes).toEqual([]);
  });

  it("does not flag a skill that only mentions the heading in prose", () => {
    writeSkill(g(".agents/skills/migrate-to-codex"), {
      body: "4. Fix every generated `## MANUAL MIGRATION REQUIRED` block.\n",
    });
    expect(ofKind(runDoctor({ home, cwd }).issues, "migration-damage")).toEqual([]);
  });

  it("reports a name/folder mismatch and two folders declaring one name", () => {
    writeSkill(g(".agents/skills/social-media-posting"));
    writeSkill(g(".agents/skills/social-media-posting-skill"), { name: "social-media-posting" });

    const report = runDoctor({ home, cwd });
    const mismatch = ofKind(report.issues, "name-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].skill).toBe("social-media-posting-skill");

    const dup = ofKind(report.issues, "duplicate-name");
    expect(dup).toHaveLength(1);
    expect(dup[0].skill).toBe("social-media-posting");
    expect(dup[0].paths).toHaveLength(2);
    expect(dup[0].agents).toEqual(expect.arrayContaining(["codex", "grok", "cursor"]));
    expect(dup[0].agents).not.toContain("claude-code");
  });

  it("checks the agentskills.io name and description limits", () => {
    writeSkill(g(".agents/skills/Bad_Name"), { name: "Bad_Name" });
    writeSkill(g(".agents/skills/no-desc"), { description: null });
    writeSkill(g(".agents/skills/long-desc"), { description: "x".repeat(1025) });
    writeSkill(g(".agents/skills/" + "a".repeat(65)), { name: "a".repeat(65) });

    const report = runDoctor({ home, cwd });
    expect(ofKind(report.issues, "bad-name").map((i) => i.skill).sort()).toEqual(["Bad_Name", "a".repeat(65)].sort());
    const desc = ofKind(report.issues, "bad-description");
    expect(desc.map((i) => i.skill).sort()).toEqual(["long-desc", "no-desc"]);
    expect(desc.find((i) => i.skill === "long-desc")?.message).toContain("1025");
  });

  it("reads folded block descriptions", () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: >\n  one\n  two\n---\nbody")).toEqual({
      name: "a",
      description: "one two",
    });
    expect(parseSkillFrontmatter('---\nname: "q"\ndescription: \'d: x\'\n---\n')).toEqual({ name: "q", description: "d: x" });
    expect(parseSkillFrontmatter("no frontmatter")).toBeNull();
  });
});

describe("vskill doctor — ignored folders and scopes", () => {
  it("ignores ~/.claude/skills/synced and folders starting with _ or .", () => {
    writeSkill(g(".agents/skills/foo"), { body: "a\n" });
    mkdirSync(g(".claude/skills/synced/foo"), { recursive: true });
    writeFileSync(g(".claude/skills/synced/foo/SKILL.md"), "different");
    writeSkill(g(".claude/skills/synced"), { name: "Not_Valid", description: null });
    writeSkill(g(".claude/skills/_archive"), { name: "Nope" });
    link(join(outside, "gone"), g(".cursor/skills/.hidden"));
    link(join(outside, "gone"), g(".cursor/skills/_old"));

    const report = runDoctor({ home, cwd });
    expect(report.issues).toEqual([]);
  });

  it("checks the project scope and honors --global / --project", () => {
    writeSkill(proj(".agents/skills/foo"));
    writeSkill(proj(".claude/skills/foo"));
    link(join(outside, "gone"), g(".grok/skills/broken"));

    const both = runDoctor({ home, cwd });
    expect(both.issues.map((i) => `${i.scope}:${i.kind}`).sort()).toEqual([
      "global:broken-link",
      "project:identical-copy",
    ]);

    const globalOnly = runDoctor({ home, cwd, global: true });
    expect(globalOnly.scopes).toEqual(["global"]);
    expect(globalOnly.issues.map((i) => i.kind)).toEqual(["broken-link"]);

    const projectOnly = runDoctor({ home, cwd, project: true });
    expect(projectOnly.scopes).toEqual(["project"]);
    expect(projectOnly.issues.map((i) => i.kind)).toEqual(["identical-copy"]);

    const fixed = runDoctor({ home, cwd, project: true, fix: true });
    expect(readlinkSync(proj(".claude/skills/foo"))).toBe("../../.agents/skills/foo");
    expect(fixed.remaining).toBe(0);
    // global scope untouched by a --project fix
    expect(lstatSync(g(".grok/skills/broken")).isSymbolicLink()).toBe(true);
  });

  it("skips the project scope when run from the home directory", () => {
    const report = runDoctor({ home, cwd: home });
    expect(report.scopes).toEqual(["global"]);
  });
});

describe("doctorCommand", () => {
  it("prints JSON and exits 1 while problems remain, 0 after --fix clears them", async () => {
    link(join(outside, "gone"), g(".cursor/skills/broken"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await doctorCommand({ home, cwd, json: true });
      const parsed = JSON.parse(log.mock.calls.at(-1)![0] as string);
      expect(parsed.summary["broken-link"]).toBe(1);
      expect(parsed.remaining).toBe(1);
      expect(process.exitCode).toBe(1);

      await doctorCommand({ home, cwd, fix: true });
      expect(process.exitCode).toBe(0);
      const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("removed link");
      expect(printed).toContain("No problems found.");
    } finally {
      log.mockRestore();
    }
  });
});
