// ---------------------------------------------------------------------------
// Regression test for the Publish-button silently dropping authored skill
// files. Root cause was `skills/` in the repo .gitignore: the OWN-scope
// path `<root>/skills/<name>/SKILL.md` (resolveScopePath in
// src/studio/lib/scope-transfer.ts) was ignored, so `git add -A` skipped it
// during /api/git/publish and only an unrelated tracked-file diff (e.g.
// agents.json regen) ended up in the commit.
//
// This test stands up a real temp git repo, copies the project's actual
// .gitignore into it, writes a skill at skills/<name>/SKILL.md, and asserts:
//   1. `git status --porcelain` reports the file as dirty (not ignored), and
//   2. `git add -A && git commit` actually commits it.
//
// If somebody re-adds `skills/` to .gitignore (or a wildcard equivalent),
// this test fails immediately.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const PROJECT_GITIGNORE = join(REPO_ROOT, ".gitignore");

function git(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("publish-flow .gitignore regression", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "vskill-publish-gi-"));
    expect(git(["init", "-q", "-b", "main"], workdir).code).toBe(0);
    git(["config", "user.email", "test@example.com"], workdir);
    git(["config", "user.name", "Test"], workdir);
    git(["config", "commit.gpgsign", "false"], workdir);
    copyFileSync(PROJECT_GITIGNORE, join(workdir, ".gitignore"));
    writeFileSync(join(workdir, "README.md"), "seed\n");
    expect(git(["add", "-A"], workdir).code).toBe(0);
    expect(git(["commit", "-q", "-m", "seed"], workdir).code).toBe(0);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("an authored skill at skills/<name>/SKILL.md is NOT ignored by .gitignore", () => {
    const skillDir = join(workdir, "skills", "remotion-best-practices");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: remotion-best-practices\n---\nbody\n");

    // The file itself must not be flagged as ignored. (The publish flow's
    // `git add -A` will recurse into the dir; what matters is per-file ignore
    // status, not whether `git status` collapses the dir to `?? skills/`.)
    const ignoreCheck = git(
      ["check-ignore", "-v", "skills/remotion-best-practices/SKILL.md"],
      workdir,
    );
    // git check-ignore exits 1 when the path is NOT ignored — that's success.
    expect(ignoreCheck.code).toBe(1);
    expect(ignoreCheck.stdout).toBe("");

    // And `git add -A` followed by `git commit` must actually capture the file.
    expect(git(["add", "-A"], workdir).code).toBe(0);
    const commit = git(["commit", "-q", "-m", "feat: remotion-best-practices skill"], workdir);
    expect(commit.code).toBe(0);

    const tracked = git(["ls-files", "skills"], workdir);
    expect(tracked.stdout).toContain("skills/remotion-best-practices/SKILL.md");
  });

  it("OWN-scope skills survive a publish-style add+commit round-trip", () => {
    // Mirrors what makePostGitPublishHandler does after the user provides a
    // commitMessage: status → add -A → commit -m "...".
    const skillDir = join(workdir, "skills", "greet-elena");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: greet-elena\n---\n");
    writeFileSync(join(skillDir, "draft.json"), "{}\n");

    expect(git(["check-ignore", "-q", "skills/greet-elena/SKILL.md"], workdir).code).toBe(1);
    expect(git(["check-ignore", "-q", "skills/greet-elena/draft.json"], workdir).code).toBe(1);
    expect(git(["add", "-A"], workdir).code).toBe(0);
    expect(git(["commit", "-q", "-m", "feat: greet-elena"], workdir).code).toBe(0);

    const show = git(["show", "--name-only", "--format=", "HEAD"], workdir);
    expect(show.stdout).toContain("skills/greet-elena/SKILL.md");
    expect(show.stdout).toContain("skills/greet-elena/draft.json");
  });

  it("unrelated agent-platform install dirs (.agents/, .opencode/) ARE still ignored", () => {
    // Sanity check: removing `skills/` from .gitignore must NOT regress the
    // ignores for platform install directories. These paths are listed
    // explicitly in .gitignore alongside .agent/, .aider/, etc.
    mkdirSync(join(workdir, ".agents", "skills", "x"), { recursive: true });
    writeFileSync(join(workdir, ".agents", "skills", "x", "SKILL.md"), "x\n");
    mkdirSync(join(workdir, ".opencode", "skills", "y"), { recursive: true });
    writeFileSync(join(workdir, ".opencode", "skills", "y", "SKILL.md"), "y\n");

    const status = git(["status", "--porcelain"], workdir);
    expect(status.stdout).not.toMatch(/\.agents\//);
    expect(status.stdout).not.toMatch(/\.opencode\//);
  });
});

// Belt-and-suspenders: assert against the .gitignore file itself so a future
// edit that re-introduces a broad `skills/` rule fails fast with a clear msg.
describe("project .gitignore", () => {
  it("does not contain a broad `skills/` ignore at the top level", () => {
    const text = readFileSync(PROJECT_GITIGNORE, "utf8");
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    // Allowed: `**/skills/skills/` (double-namespace guard).
    // Disallowed: any standalone `skills/` rule that would silently ignore
    // the studio's OWN-scope author path.
    const offending = lines.find((l) => l === "skills/" || l === "/skills/");
    expect(
      offending,
      "skills/ in .gitignore would break the studio Publish flow — see commit message for context",
    ).toBeUndefined();
  });
});
