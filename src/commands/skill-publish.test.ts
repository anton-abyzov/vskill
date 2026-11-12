import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const git = vi.hoisted(() => ({
  checkout: null as null | { root: string; owner: string | null; repo: string | null },
  tracked: [] as string[],
  names: {} as Record<string, string>,
}));
vi.mock("../lib/git-checkout.js", () => ({
  readLocalCheckout: () => git.checkout,
  listTrackedSkillFiles: () => git.tracked,
  readSkillName: (abs: string) => git.names[abs] ?? null,
  toRepoPath: (c: { root: string }, abs: string) => (abs.startsWith(c.root + "/") ? abs.slice(c.root.length + 1) : null),
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
    expect(resolvePublishTarget("greet", dir)).toEqual({ source: "myorg/skills", skill: "greet", path: "tools/greeter/SKILL.md" });
  });

  it("matches a skill by its folder name", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["tools/greeter/SKILL.md"];
    expect(resolvePublishTarget("greeter", dir)).toEqual({ source: "myorg/skills", skill: "greeter", path: "tools/greeter/SKILL.md" });
  });

  it("prefers the authored-skills record and keeps the repo path when the checkout is that repo", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    writeFileSync(
      join(dir, "vskill.authored.json"),
      JSON.stringify({ version: 1, skills: { "myorg/skills/greet": { sourcePath: join(dir, "greet/SKILL.md"), publishedAt: "x" } } }),
    );
    expect(resolvePublishTarget("greet", dir)).toEqual({ source: "myorg/skills", skill: "greet", path: "greet/SKILL.md" });
  });

  it("returns null when nothing names the skill", () => {
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    expect(resolvePublishTarget("nope", dir)).toBeNull();
  });
});

describe("skillPublishCommand", () => {
  it("runs the submit path with the resolved repo, skill and path", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    git.checkout = { root: dir, owner: "myorg", repo: "skills" };
    git.tracked = ["SKILL.md"];
    git.names = { [join(dir, "SKILL.md")]: "greet" };
    await skillPublishCommand("greet", { wait: true });
    expect(mockSubmit).toHaveBeenCalledWith("myorg/skills", { skill: "greet", path: "SKILL.md", wait: true });
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
