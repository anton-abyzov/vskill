import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isCommitted,
  isOnOriginBranch,
  listTrackedSkillFiles,
  locateSkillFile,
  parseGitHubRemote,
  readLocalCheckout,
  readSkillName,
  toRepoPath,
} from "../git-checkout.js";

// Real git repos in a temp dir; the "GitHub" remote is a local bare repo
// whose URL is rewritten with url.<base>.insteadOf so origin still parses as
// github.com/myorg/greet-skill.

let base: string;
let work: string;
let bare: string;

function g(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "vskill-git-checkout-")));
  work = join(base, "work");
  bare = join(base, "remote.git");
  mkdirSync(work);
  g(base, "init", "--bare", "-q", bare);
  g(work, "init", "-q", "-b", "main");
  g(work, "config", `url.${bare}.insteadOf`, "https://github.com/myorg/greet-skill.git");
  mkdirSync(join(work, "skills", "greet"), { recursive: true });
  writeFileSync(join(work, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Say hi\n---\n\nHi\n");
  g(work, "add", "-A");
  g(work, "commit", "-q", "-m", "init");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("readLocalCheckout", () => {
  it("returns null outside a git work tree", () => {
    const plain = join(base, "plain");
    mkdirSync(plain);
    expect(readLocalCheckout(plain)).toBeNull();
  });

  it("reports no origin for a fresh `git init` repo", () => {
    const c = readLocalCheckout(work)!;
    expect(c.root).toBe(work);
    expect(c.remoteUrl).toBeNull();
    expect(c.owner).toBeNull();
    expect(c.branch).toBe("main");
    expect(c.hasUpstream).toBe(false);
    expect(c.pushed).toBe(false);
  });

  it("parses the GitHub owner/repo from origin and sees an unpushed branch", () => {
    g(work, "remote", "add", "origin", "https://github.com/myorg/greet-skill.git");
    const c = readLocalCheckout(join(work, "skills", "greet"))!;
    expect(c.owner).toBe("myorg");
    expect(c.repo).toBe("greet-skill");
    expect(c.hasUpstream).toBe(false);
    expect(c.pushed).toBe(false);
  });

  it("reports pushed after `git push -u origin HEAD`, and not pushed again after a new commit", () => {
    g(work, "remote", "add", "origin", "https://github.com/myorg/greet-skill.git");
    g(work, "push", "-q", "-u", "origin", "HEAD");
    expect(readLocalCheckout(work)!.pushed).toBe(true);
    writeFileSync(join(work, "README.md"), "x\n");
    g(work, "add", "README.md");
    g(work, "commit", "-q", "-m", "more");
    const c = readLocalCheckout(work)!;
    expect(c.hasUpstream).toBe(true);
    expect(c.pushed).toBe(false);
  });
});

describe("default branch", () => {
  it("is null until origin/HEAD is known, then names it; files are checked on origin's branch", () => {
    g(work, "remote", "add", "origin", "https://github.com/myorg/greet-skill.git");
    g(work, "push", "-q", "-u", "origin", "HEAD");
    expect(readLocalCheckout(work)!.defaultBranch).toBeNull();
    g(work, "remote", "set-head", "origin", "main");
    g(work, "checkout", "-q", "-b", "add-other");
    mkdirSync(join(work, "skills", "other"));
    writeFileSync(join(work, "skills", "other", "SKILL.md"), "---\nname: other\n---\n");
    g(work, "add", "-A");
    g(work, "commit", "-q", "-m", "other");
    g(work, "push", "-q", "-u", "origin", "HEAD");
    const c = readLocalCheckout(work)!;
    expect(c.defaultBranch).toBe("main");
    expect(c.branch).toBe("add-other");
    expect(isOnOriginBranch(c, "main", "skills/greet/SKILL.md")).toBe(true);
    expect(isOnOriginBranch(c, "main", "skills/other/SKILL.md")).toBe(false);
    expect(isOnOriginBranch(c, "add-other", "skills/other/SKILL.md")).toBe(true);
  });
});

describe("skill file helpers", () => {
  it("lists tracked SKILL.md files and maps paths repo-relative", () => {
    const c = readLocalCheckout(work)!;
    expect(listTrackedSkillFiles(c)).toEqual(["skills/greet/SKILL.md"]);
    expect(toRepoPath(c, join(work, "skills", "greet", "SKILL.md"))).toBe("skills/greet/SKILL.md");
    expect(toRepoPath(c, join(base, "elsewhere", "SKILL.md"))).toBeNull();
  });

  it("knows whether a file is committed", () => {
    const c = readLocalCheckout(work)!;
    expect(isCommitted(c, "skills/greet/SKILL.md")).toBe(true);
    writeFileSync(join(work, "SKILL.md"), "---\nname: root\n---\n");
    expect(isCommitted(c, "SKILL.md")).toBe(false);
  });

  it("locates --path relative to the repo root from a subfolder", () => {
    const c = readLocalCheckout(work)!;
    const found = locateSkillFile({ path: "skills/greet/SKILL.md", cwd: join(work, "skills"), checkout: c });
    expect(found).toBe(join(work, "skills", "greet", "SKILL.md"));
    expect(locateSkillFile({ cwd: join(work, "skills", "greet"), checkout: c })).toBe(
      join(work, "skills", "greet", "SKILL.md"),
    );
    expect(locateSkillFile({ cwd: work, checkout: c })).toBeNull();
  });

  it("reads the frontmatter name, falling back to the folder name", () => {
    expect(readSkillName(join(work, "skills", "greet", "SKILL.md"))).toBe("greet");
    mkdirSync(join(work, "skills", "noname"));
    writeFileSync(join(work, "skills", "noname", "SKILL.md"), "# no frontmatter\n");
    expect(readSkillName(join(work, "skills", "noname", "SKILL.md"))).toBe("noname");
    writeFileSync(join(work, "skills", "noname", "SKILL.md"), "---\nname: \"quoted-name\"\n---\n");
    expect(readSkillName(join(work, "skills", "noname", "SKILL.md"))).toBe("quoted-name");
  });
});

describe("parseGitHubRemote", () => {
  it.each([
    ["https://github.com/myorg/greet-skill.git", "myorg", "greet-skill"],
    ["https://github.com/myorg/greet-skill", "myorg", "greet-skill"],
    ["https://x-access-token@github.com/myorg/greet-skill.git", "myorg", "greet-skill"],
    ["git@github.com:myorg/greet-skill.git", "myorg", "greet-skill"],
    ["ssh://git@github.com/myorg/greet-skill.git", "myorg", "greet-skill"],
  ])("parses %s", (url, owner, repo) => {
    expect(parseGitHubRemote(url)).toEqual({ owner, repo });
  });

  it.each(["https://gitlab.com/o/r.git", "git@bitbucket.org:o/r.git", "/tmp/remote.git"])("rejects %s", (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});
