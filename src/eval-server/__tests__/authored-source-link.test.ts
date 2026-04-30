// ---------------------------------------------------------------------------
// 0770: authored-skill GitHub link detection
//
// Locally-authored skills (no lockfile entry) whose parent directory is a
// git repo with a github.com origin remote should expose `repoUrl` and
// `skillPath` to /api/skills, so the existing SourceFileLink anchor lights
// up the same way it does for platform-installed skills.
//
// Three exported helpers are tested: parseGithubRemote (pure regex),
// walkUpForGitRoot (filesystem walk), detectAuthoredSourceLink (composes
// the two with two `git` invocations and module-level memoization).
//
// Plus three integration cases covering precedence: lockfile wins, fall-
// through fires when no lockfile, no link when no .git ancestor.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseGithubRemote,
  walkUpForGitRoot,
  detectAuthoredSourceLink,
  resetAuthoredSourceLinkCache,
  buildSkillMetadata,
} from "../api-routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitInit(dir: string, remote: string | null): void {
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: dir,
    stdio: ["ignore", "ignore", "ignore"],
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  if (remote) {
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  }
}

function commitAll(dir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: dir,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function writeSkill(dir: string, frontmatter: string[]): string {
  mkdirSync(dir, { recursive: true });
  const fm = ["---", ...frontmatter, "---", "", "# body", ""].join("\n");
  const skillMd = join(dir, "SKILL.md");
  writeFileSync(skillMd, fm, "utf-8");
  return skillMd;
}

function seedLockfile(
  root: string,
  skills: Record<string, {
    version: string;
    sha: string;
    tier: string;
    installedAt: string;
    source: string;
    sourceRepoUrl?: string;
    sourceSkillPath?: string;
  }>,
): void {
  const full = {
    version: 1,
    agents: ["claude-code"],
    skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  writeFileSync(join(root, "vskill.lock"), JSON.stringify(full, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// T-001 / T-002: parseGithubRemote — pure regex parser
// ---------------------------------------------------------------------------

describe("0770 parseGithubRemote", () => {
  it("TC-001: SSH remote with .git suffix → canonical https URL", () => {
    expect(parseGithubRemote("git@github.com:anton-abyzov/greet-anton.git")).toBe(
      "https://github.com/anton-abyzov/greet-anton",
    );
  });

  it("TC-002: SSH remote without .git suffix → canonical https URL", () => {
    expect(parseGithubRemote("git@github.com:anton-abyzov/greet-anton")).toBe(
      "https://github.com/anton-abyzov/greet-anton",
    );
  });

  it("TC-003: HTTPS remote with .git suffix → strips .git", () => {
    expect(parseGithubRemote("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("TC-004: HTTPS remote without .git suffix → unchanged canonical", () => {
    expect(parseGithubRemote("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("TC-005: ssh:// URL form → canonical https URL", () => {
    expect(parseGithubRemote("ssh://git@github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("TC-006: non-github SSH (gitlab) → null", () => {
    expect(parseGithubRemote("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("TC-007: non-github HTTPS (bitbucket) → null", () => {
    expect(parseGithubRemote("https://bitbucket.org/owner/repo")).toBeNull();
  });

  it("TC-008: empty string → null", () => {
    expect(parseGithubRemote("")).toBeNull();
  });

  it("TC-009: whitespace-only → null", () => {
    expect(parseGithubRemote("   ")).toBeNull();
  });

  it("TC-010: malformed URL → null", () => {
    expect(parseGithubRemote("not-a-url")).toBeNull();
  });

  it("TC-010b: http:// (not https) is still accepted as github", () => {
    // Some configs use http://github.com; the canonicalization upgrades to https.
    expect(parseGithubRemote("http://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo",
    );
  });
});

// ---------------------------------------------------------------------------
// T-003 / T-004: walkUpForGitRoot — .git ancestor walker
// ---------------------------------------------------------------------------

describe("0770 walkUpForGitRoot", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "walk-up-git-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("TC-011: .git directory at start dir → returns start dir", () => {
    mkdirSync(join(tmpRoot, ".git"));
    expect(walkUpForGitRoot(tmpRoot)).toBe(resolve(tmpRoot));
  });

  it("TC-011b: .git directory at parent → returns parent", () => {
    mkdirSync(join(tmpRoot, ".git"));
    const child = join(tmpRoot, "skill");
    mkdirSync(child);
    expect(walkUpForGitRoot(child)).toBe(resolve(tmpRoot));
  });

  it("TC-012: .git FILE (worktree case) → returns parent", () => {
    // Worktrees use a `.git` FILE pointing to the main repo's .git dir.
    writeFileSync(join(tmpRoot, ".git"), "gitdir: /some/path/.git/worktrees/x", "utf-8");
    const child = join(tmpRoot, "skill");
    mkdirSync(child);
    expect(walkUpForGitRoot(child)).toBe(resolve(tmpRoot));
  });

  it("TC-013: no .git anywhere → null", () => {
    const isolated = mkdtempSync(join(tmpdir(), "no-git-"));
    try {
      expect(walkUpForGitRoot(isolated)).toBeNull();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("TC-014: bails at filesystem root without throwing", () => {
    // /tmp/<randomdir> with no .git anywhere up the chain → walk hits root and
    // returns null cleanly. (We don't put .git in /tmp; tmpdir() gives us a
    // disposable path inside the OS tmp.)
    const isolated = mkdtempSync(join(tmpdir(), "fs-root-bail-"));
    try {
      expect(() => walkUpForGitRoot(isolated)).not.toThrow();
      expect(walkUpForGitRoot(isolated)).toBeNull();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("TC-015: respects maxLevels cap", () => {
    // Build a chain a/b/c/.../n (15 levels) with .git only at top.
    mkdirSync(join(tmpRoot, ".git"));
    let current = tmpRoot;
    for (let i = 0; i < 15; i++) {
      current = join(current, `level${i}`);
      mkdirSync(current);
    }
    // With maxLevels = 12, the 15-level-deep dir cannot reach .git at the top.
    expect(walkUpForGitRoot(current, 12)).toBeNull();
    // With higher cap, it CAN find .git.
    expect(walkUpForGitRoot(current, 50)).toBe(resolve(tmpRoot));
  });
});

// ---------------------------------------------------------------------------
// T-005 / T-006: detectAuthoredSourceLink — composes helpers + git
// ---------------------------------------------------------------------------

describe("0770 detectAuthoredSourceLink", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "authored-detect-"));
    resetAuthoredSourceLinkCache();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("TC-016: authored skill at repo root with SSH github remote → repoUrl + skillPath", () => {
    gitInit(tmpRoot, "git@github.com:a/b.git");
    writeSkill(tmpRoot, ["name: a-skill", "description: x"]);
    commitAll(tmpRoot, "init");

    const result = detectAuthoredSourceLink(tmpRoot);
    expect(result.repoUrl).toBe("https://github.com/a/b");
    expect(result.skillPath).toBe("SKILL.md");
  });

  it("TC-017: authored skill at skills/foo/SKILL.md (multi-skill repo) → nested path", () => {
    gitInit(tmpRoot, "https://github.com/owner/repo.git");
    const skillDir = join(tmpRoot, "skills", "foo");
    writeSkill(skillDir, ["name: foo", "description: x"]);
    commitAll(tmpRoot, "init");

    const result = detectAuthoredSourceLink(skillDir);
    expect(result.repoUrl).toBe("https://github.com/owner/repo");
    expect(result.skillPath).toBe("skills/foo/SKILL.md");
  });

  it("TC-018: no .git anywhere → null/null", () => {
    const skillDir = join(tmpRoot, "skills", "bare");
    writeSkill(skillDir, ["name: bare"]);

    const result = detectAuthoredSourceLink(skillDir);
    expect(result.repoUrl).toBeNull();
    expect(result.skillPath).toBeNull();
  });

  it("TC-019: non-github remote (gitlab) → null/null", () => {
    gitInit(tmpRoot, "git@gitlab.com:owner/repo.git");
    writeSkill(tmpRoot, ["name: x"]);

    const result = detectAuthoredSourceLink(tmpRoot);
    expect(result.repoUrl).toBeNull();
    expect(result.skillPath).toBeNull();
  });

  it("TC-020: untracked SKILL.md (no commit) → filesystem fallback path", () => {
    gitInit(tmpRoot, "git@github.com:a/b.git");
    const skillDir = join(tmpRoot, "skills", "untracked");
    writeSkill(skillDir, ["name: untracked"]);
    // No commit — SKILL.md is not tracked yet.

    const result = detectAuthoredSourceLink(skillDir);
    expect(result.repoUrl).toBe("https://github.com/a/b");
    expect(result.skillPath).toBe("skills/untracked/SKILL.md");
  });

  it("TC-021: memoization — second call returns cached value even if .git is removed", () => {
    gitInit(tmpRoot, "git@github.com:a/b.git");
    writeSkill(tmpRoot, ["name: x"]);
    commitAll(tmpRoot, "init");

    const first = detectAuthoredSourceLink(tmpRoot);
    expect(first.repoUrl).toBe("https://github.com/a/b");

    // Nuke the .git dir — if memoization works, the second call still returns
    // the same value because no new git invocation occurs.
    rmSync(join(tmpRoot, ".git"), { recursive: true, force: true });

    const second = detectAuthoredSourceLink(tmpRoot);
    expect(second.repoUrl).toBe("https://github.com/a/b");
    expect(second.skillPath).toBe(first.skillPath);
  });

  it("TC-022: never throws on git failure (e.g. git not on PATH or remote missing)", () => {
    // Init without a remote → `git config --get remote.origin.url` exits non-zero.
    gitInit(tmpRoot, null);
    writeSkill(tmpRoot, ["name: x"]);

    expect(() => detectAuthoredSourceLink(tmpRoot)).not.toThrow();
    const result = detectAuthoredSourceLink(tmpRoot);
    expect(result.repoUrl).toBeNull();
    expect(result.skillPath).toBeNull();
  });

  it("TC-023: cache key is the absolute skill dir (resolves relative inputs)", () => {
    gitInit(tmpRoot, "git@github.com:a/b.git");
    writeSkill(tmpRoot, ["name: x"]);
    commitAll(tmpRoot, "init");

    // Call once with the absolute path…
    const abs = detectAuthoredSourceLink(tmpRoot);
    // Nuke .git so a fresh call would fail without cache.
    rmSync(join(tmpRoot, ".git"), { recursive: true, force: true });
    // …and call again with the same absolute path (Node will not rewrite it).
    const abs2 = detectAuthoredSourceLink(resolve(tmpRoot));
    expect(abs2).toEqual(abs);
  });
});

// ---------------------------------------------------------------------------
// T-007 / T-008: resolveSourceLink precedence (via buildSkillMetadata)
// ---------------------------------------------------------------------------

describe("0770 resolveSourceLink precedence (via buildSkillMetadata)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "resolve-source-link-"));
    resetAuthoredSourceLinkCache();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("TC-024: lockfile precedence preserved — explicit lockfile wins over local git remote", () => {
    // Workspace is a git repo with a "wrong" remote, but the lockfile has an
    // authoritative entry. Lockfile must win.
    gitInit(tmpRoot, "git@github.com:wrong/repo.git");
    const skillDir = join(tmpRoot, ".claude", "skills", "platform-skill");
    writeSkill(skillDir, ["name: platform-skill", "description: x"]);
    seedLockfile(tmpRoot, {
      "platform-skill": {
        version: "1.0.0",
        sha: "abc",
        tier: "VERIFIED",
        installedAt: "2026-04-26T00:00:00.000Z",
        source: "github:correct/repo",
        sourceRepoUrl: "https://github.com/correct/repo",
        sourceSkillPath: "skills/platform-skill/SKILL.md",
      },
    });
    commitAll(tmpRoot, "init");

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/correct/repo");
    expect(md.skillPath).toBe("skills/platform-skill/SKILL.md");
  });

  it("TC-025: authored fall-through fires when no lockfile entry — uses local git remote", () => {
    gitInit(tmpRoot, "git@github.com:author/repo.git");
    const skillDir = join(tmpRoot, ".claude", "skills", "my-authored-skill");
    writeSkill(skillDir, ["name: my-authored-skill", "description: x"]);
    commitAll(tmpRoot, "init");
    // No lockfile written.

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/author/repo");
    expect(md.skillPath).toBe(".claude/skills/my-authored-skill/SKILL.md");
  });

  it("TC-026: authored skill outside any git repo → null/null (copy-chip fallback)", () => {
    const skillDir = join(tmpRoot, ".claude", "skills", "no-git-skill");
    writeSkill(skillDir, ["name: no-git-skill", "description: x"]);
    // No git init, no lockfile.

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.repoUrl ?? null).toBeNull();
    expect(md.skillPath ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 0809: resolveSourceLink with copied-skill sidecar
// ---------------------------------------------------------------------------

import { resetCopiedSkillSidecarCache } from "../source-link.js";

function writeSidecar(skillDir: string, payload: unknown): void {
  writeFileSync(
    join(skillDir, ".vskill-source.json"),
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    "utf-8",
  );
}

describe("0809 resolveSourceLink with sidecar", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "0809-resolve-sidecar-"));
    resetAuthoredSourceLinkCache();
    resetCopiedSkillSidecarCache();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    resetAuthoredSourceLinkCache();
    resetCopiedSkillSidecarCache();
  });

  it("TC-010: sidecar wins when no lockfile entry — copied skill outside any github-rooted git", () => {
    // No lockfile, no git ancestor — only the sidecar should produce a link.
    const skillDir = join(tmpRoot, ".claude", "skills", "survey-passing");
    writeSkill(skillDir, ["name: survey-passing"]);
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
      skillPath: "SKILL.md",
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/anton-abyzov/greet-anton-test");
    expect(md.skillPath).toBe("SKILL.md");
  });

  it("TC-011: lockfile beats sidecar — explicit install receipt is more authoritative", () => {
    const skillDir = join(tmpRoot, ".claude", "skills", "platform-skill");
    writeSkill(skillDir, ["name: platform-skill", "description: x"]);

    // Sidecar points one way, lockfile points another way — lockfile must win.
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/sidecar-loser/repo",
      skillPath: "SKILL.md",
    });
    seedLockfile(tmpRoot, {
      "platform-skill": {
        version: "1.0.0",
        sha: "abc",
        tier: "VERIFIED",
        installedAt: "2026-04-30T00:00:00.000Z",
        source: "github:lockfile-winner/repo",
        sourceRepoUrl: "https://github.com/lockfile-winner/repo",
        sourceSkillPath: "skills/platform-skill/SKILL.md",
      },
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/lockfile-winner/repo");
    expect(md.skillPath).toBe("skills/platform-skill/SKILL.md");
  });

  it("TC-012: sidecar beats authored detector — copy-time snapshot beats local git remote", () => {
    // Workspace is a git repo with origin pointing at the umbrella ("wrong"
    // remote for a copied skill). Sidecar must override the authored detector
    // so the copied skill's link resolves to its true source.
    gitInit(tmpRoot, "git@github.com:wrong-umbrella/repo.git");
    const skillDir = join(tmpRoot, ".claude", "skills", "copied-skill");
    writeSkill(skillDir, ["name: copied-skill"]);
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/true-source/repo",
      skillPath: "SKILL.md",
    });
    commitAll(tmpRoot, "init");

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/true-source/repo");
    expect(md.skillPath).toBe("SKILL.md");
  });

  it("TC-013: malformed sidecar falls through to authored detector — no broken anchor", () => {
    gitInit(tmpRoot, "git@github.com:fallback/repo.git");
    const skillDir = join(tmpRoot, ".claude", "skills", "broken-sidecar-skill");
    writeSkill(skillDir, ["name: broken-sidecar-skill"]);
    writeSidecar(skillDir, "not valid json{");
    commitAll(tmpRoot, "init");

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/fallback/repo");
    expect(md.skillPath).toBe(".claude/skills/broken-sidecar-skill/SKILL.md");
  });

  it("TC-013b: non-github sidecar (gitlab) falls through to authored detector", () => {
    gitInit(tmpRoot, "git@github.com:fallback/repo.git");
    const skillDir = join(tmpRoot, ".claude", "skills", "gitlab-source-skill");
    writeSkill(skillDir, ["name: gitlab-source-skill"]);
    writeSidecar(skillDir, {
      repoUrl: "https://gitlab.com/x/y",
      skillPath: "SKILL.md",
    });
    commitAll(tmpRoot, "init");

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/fallback/repo");
  });
});
