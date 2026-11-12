import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const git = vi.hoisted(() => ({
  checkout: null as null | { root: string; owner: string | null; repo: string | null },
  tracked: [] as string[],
  names: {} as Record<string, string>,
}));
// Real sameRepo / toRepoPath; the checkout and its tracked files are fixtures.
// findTrackedSkill's own matching is covered against real git in
// lib/__tests__/git-checkout.test.ts.
vi.mock("../lib/git-checkout.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/git-checkout.js")>()),
  readLocalCheckout: () => git.checkout,
  findTrackedSkill: (c: { root: string }, name: string) => {
    for (const repoPath of git.tracked) {
      const file = join(c.root, repoPath);
      const folder = repoPath.split("/").slice(-2, -1)[0];
      const skillName = git.names[file] ?? folder ?? null;
      if (skillName === name) return { file, repoPath, name: skillName };
    }
    return null;
  },
}));

const mockSubmit = vi.fn();
vi.mock("./submit.js", () => ({ submitCommand: (...a: unknown[]) => mockSubmit(...a) }));

const { resolvePublishTarget, skillPublishCommand } = await import("./skill-publish.js");

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "vskill-publish-")));
  git.checkout = null;
  git.tracked = [];
  git.names = {};
  mockSubmit.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolvePublishTarget", () => {
  it("finds a tracked SKILL.md in the current checkout by frontmatter name", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["a/SKILL.md", "tools/greeter/SKILL.md"];
    git.names = { [join(dir, "a/SKILL.md")]: "alpha", [join(dir, "tools/greeter/SKILL.md")]: "greet" };
    expect(resolvePublishTarget("greet", dir)).toEqual({
      source: "myorg/skills",
      skill: "greet",
      path: "tools/greeter/SKILL.md",
      localFile: join(dir, "tools/greeter/SKILL.md"),
    });
  });

  it("matches a skill by its folder name", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["tools/greeter/SKILL.md"];
    expect(resolvePublishTarget("greeter", dir)).toEqual({
      source: "myorg/skills",
      skill: "greeter",
      path: "tools/greeter/SKILL.md",
      localFile: join(dir, "tools/greeter/SKILL.md"),
    });
  });

  it("prefers the authored-skills record and keeps the repo path when the checkout is that repo", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    mkdirSync(join(dir, "greet"));
    writeFileSync(join(dir, "greet/SKILL.md"), "---\nname: greet\n---\n");
    writeFileSync(
      join(dir, "vskill.authored.json"),
      JSON.stringify({ version: 1, skills: { "myorg/skills/greet": { sourcePath: join(dir, "greet/SKILL.md"), publishedAt: "x" } } }),
    );
    expect(resolvePublishTarget("greet", dir)).toEqual({
      source: "myorg/skills",
      skill: "greet",
      path: "greet/SKILL.md",
      localFile: join(dir, "greet/SKILL.md"),
    });
  });

  it("keeps an authored record of another repo remote-only", () => {
    git.checkout = { root: dir, owner: "someone", repo: "else" };
    writeFileSync(
      join(dir, "vskill.authored.json"),
      JSON.stringify({ version: 1, skills: { "myorg/skills/greet": { sourcePath: join(dir, "greet/SKILL.md"), publishedAt: "x" } } }),
    );
    expect(resolvePublishTarget("greet", dir)).toEqual({ source: "myorg/skills", skill: "greet" });
  });

  it("returns null when nothing names the skill", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    expect(resolvePublishTarget("nope", dir)).toBeNull();
  });
});

describe("skillPublishCommand", () => {
  it("runs the submit path with the absolute local SKILL.md and the local checks", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["SKILL.md"];
    git.names = { [join(dir, "SKILL.md")]: "greet" };
    await skillPublishCommand("greet", { wait: true });
    expect(mockSubmit).toHaveBeenCalledWith("myorg/skills", {
      skill: "greet",
      path: join(dir, "SKILL.md"),
      wait: true,
      checkLocal: true,
    });
  });

  it("passes an absolute path from a subfolder, so write-back does not resolve against the cwd", async () => {
    const sub = join(dir, "docs");
    mkdirSync(sub);
    vi.spyOn(process, "cwd").mockReturnValue(sub);
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["tools/greeter/SKILL.md"];
    await skillPublishCommand("greeter");
    expect(mockSubmit).toHaveBeenCalledWith("myorg/skills", expect.objectContaining({
      skill: "greeter",
      path: join(dir, "tools/greeter/SKILL.md"),
      checkLocal: true,
    }));
  });

  it("submits a bare owner/repo/skill without local checks", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    await skillPublishCommand("myorg/skills/greet");
    expect(mockSubmit).toHaveBeenCalledWith("myorg/skills", { skill: "greet", path: undefined, wait: undefined });
  });

  it("prints the submit command with the checkout's repo when it cannot resolve", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    const exit = vi.spyOn(process, "exit").mockImplementation((c?: number) => { throw new Error(`exit:${c}`); });
    await expect(skillPublishCommand("nope")).rejects.toThrow("exit:1");
    const err = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(err).toContain("vskill submit myorg/skills --skill nope --path <path/to/SKILL.md>");
    expect(mockSubmit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
