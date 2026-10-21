// 0850 F6: use real lockfiles, skill files, and remove handlers in isolated
// fixtures. No installed user skills or real home directory are accessed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({ home: "", failUnlink: "", sendJson: vi.fn(), readBody: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, unlinkSync: (path: import("node:fs").PathLike) => {
    if (String(path) === mocks.failUnlink) throw new Error("fixture unlink failure");
    actual.unlinkSync(path);
  } };
});
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const homedir = () => mocks.home;
  return { ...actual, homedir, default: { ...actual, homedir } };
});
vi.mock("../router.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../router.js")>(),
  sendJson: mocks.sendJson, readBody: mocks.readBody,
}));
vi.mock("../../agents/agents-registry.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../agents/agents-registry.js")>(),
  detectInstalledAgents: vi.fn(async () => []),
}));

import { registerInstallStateRoutes, type InstallStateResponse } from "../install-state-routes.js";
import { registerRemoveSkillRoutes } from "../remove-skill-routes.js";
import { readLockfile, writeLockfile } from "../../lockfile/lockfile.js";

let fixture: string;
let project: string;
const handlers: Record<string, (...args: any[]) => Promise<void>> = {};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.failUnlink = "";
  fixture = mkdtempSync(join(tmpdir(), "vskill-0850-membership-"));
  project = join(fixture, "project");
  mocks.home = join(fixture, "home");
  mkdirSync(project);
  mkdirSync(join(mocks.home, ".agents"), { recursive: true });
  vi.stubEnv("VSKILL_ANTIGRAVITY_SKILLS_DIR", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const router: any = {
    get: (path: string, handler: any) => { handlers[path] = handler; },
    post: (path: string, handler: any) => { handlers[path] = handler; },
  };
  registerInstallStateRoutes(router, () => project);
  registerRemoveSkillRoutes(router, () => project);
});
afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function root(scope: "project" | "user") { return scope === "project" ? project : mocks.home; }
function lockDir(scope: "project" | "user") { return scope === "project" ? project : join(mocks.home, ".agents"); }
function file(scope: "project" | "user", relative: string) {
  const path = join(root(scope), relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "---\nname: fixture\ndescription: fixture\n---\nFixture only.\n");
}
function lock(scope: "project" | "user", agents: string[], skills = ["foo", "bar"]) {
  writeLockfile({
    version: 1, agents, createdAt: "now", updatedAt: "now",
    skills: Object.fromEntries(skills.map((name) => [name, {
      version: "1.0.0", sha: "fixture", tier: "VERIFIED" as const, installedAt: "now", source: "github:o/r",
    }])),
  }, lockDir(scope));
}
async function state(skill = "o/r/foo"): Promise<InstallStateResponse> {
  await handlers["/api/studio/install-state"]({
    url: `/api/studio/install-state?skill=${encodeURIComponent(skill)}`,
    headers: {}, socket: { remoteAddress: "127.0.0.1" },
  }, {});
  expect(mocks.sendJson.mock.calls.at(-1)![2]).toBe(200);
  return mocks.sendJson.mock.calls.at(-1)![1];
}
async function remove(scope: "project" | "user", agentIds = ["cline"], all = false) {
  mocks.readBody.mockResolvedValueOnce({ skill: "o/r/foo", agentIds, scope, all });
  await handlers["/api/studio/remove-skill"]({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }, {});
  return mocks.sendJson.mock.calls.at(-1)![1];
}

describe.each(["project", "user"] as const)("0850 per-agent membership in %s scope", (scope) => {
  it("does not credit Cline's bar install as a foo install", async () => {
    lock(scope, ["claude-code", "cline"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    file(scope, ".cline/skills/bar/SKILL.md");
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["claude-code"]);
    expect((await state("o/r/bar")).scopes[scope].installedAgentTools).toEqual(["cline"]);
  });

  it("refreshes foo after removing it from Cline while Claude keeps foo and Cline keeps bar", async () => {
    lock(scope, ["claude-code", "cline"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    file(scope, ".cline/skills/foo/SKILL.md");
    file(scope, ".cline/skills/bar/SKILL.md");
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["claude-code", "cline"]);
    expect((await remove(scope)).removed).toEqual([expect.objectContaining({ agentId: "cline" })]);
    expect(readLockfile(lockDir(scope))?.agents).toEqual(["claude-code", "cline"]);
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["claude-code"]);
    expect((await state("o/r/bar")).scopes[scope].installedAgentTools).toEqual(["cline"]);
  });

  it("credits shared canonical readers and native symlinks, but not unrelated native tools", async () => {
    lock(scope, ["claude-code", "cline", "cursor", "codex"]);
    file(scope, ".agents/skills/foo/SKILL.md");
    mkdirSync(join(root(scope), ".claude/skills"), { recursive: true });
    symlinkSync("../../.agents/skills/foo", join(root(scope), ".claude/skills/foo"), "dir");
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["claude-code", "cursor", "codex"]);
  });

  it("recognizes a shared reader's additional native read directory", async () => {
    lock(scope, ["cursor"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["cursor"]);
  });

  it("does not trust stale receipts, missing files, or unknown agents", async () => {
    lock(scope, ["claude-code", "not-a-tool"]);
    file(scope, ".claude/skills/bar/SKILL.md");
    expect((await state()).scopes[scope]).toEqual({ installed: false, installedAgentTools: [], version: null });
  });

  it("preserves source identity gating even with a matching short-name file", async () => {
    lock(scope, ["claude-code"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    expect((await state("different/repo/foo")).scopes[scope].installed).toBe(false);
  });

  it("recognizes a skill-specific transformed rule without crediting another skill", async () => {
    lock(scope, ["windsurf"]);
    file(scope, scope === "project" ? ".windsurf/rules/foo.md" : ".codeium/windsurf/rules/foo.md");
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["windsurf"]);
    expect((await state("o/r/bar")).scopes[scope].installed).toBe(false);
  });

  it.each([
    ["windsurf", ".windsurf/rules/foo.md", ".codeium/windsurf/rules/foo.md"],
    ["cursor", ".cursor/rules/foo.mdc", ".cursor/rules/foo.mdc"],
    ["github-copilot-ext", ".github/instructions/foo.instructions.md", ".copilot/instructions/foo.instructions.md"],
    ["continue", ".continue/rules/foo.md", ".continue/rules/foo.md"],
    ["junie", ".junie/rules/foo.md", ".junie/rules/foo.md"],
    ["kiro-cli", ".kiro/steering/foo.md", ".kiro/steering/foo.md"],
    ["trae", ".trae/foo.md", ".trae/foo.md"],
    ["aider", ".aider/conventions/foo.md", ".aider/conventions/foo.md"],
  ])("removes %s's owned converted output and refreshes without touching the neighboring skill", async (agent, projectPath, userPath) => {
    const path = scope === "project" ? projectPath : userPath;
    const neighbor = path.replace("foo", "bar");
    lock(scope, [agent]);
    file(scope, path);
    file(scope, neighbor);
    const before = readFileSync(join(root(scope), neighbor), "utf8");
    expect((await state()).scopes[scope].installedAgentTools).toEqual([agent]);
    const result = await remove(scope, [agent]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.removed).toContainEqual({ agentId: agent, path: join(root(scope), path) });
    expect(existsSync(join(root(scope), path))).toBe(false);
    expect(readFileSync(join(root(scope), neighbor), "utf8")).toBe(before);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeUndefined();
    expect(readLockfile(lockDir(scope))?.agents).toContain(agent);
    expect((await state()).scopes[scope].installed).toBe(false);
    expect((await state("o/r/bar")).scopes[scope].installedAgentTools).toEqual([agent]);
  });

  it.each([false, true])("visibly refuses Aider shared configuration and preserves all files/receipts (all=%s)", async (all) => {
    lock(scope, ["aider"]);
    file(scope, ".aider/conventions/foo.md");
    file(scope, ".aider/conventions/bar.md");
    const config = join(root(scope), ".aider.conf.yml");
    const original = "# User settings\nread:\n  - .aider/conventions/foo.md\n  - .aider/conventions/bar.md\nmodel: test-model\n";
    writeFileSync(config, original);
    const result = await remove(scope, ["aider"], all);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ agentId: "aider", message: expect.stringContaining(`shared configuration at ${config}`) })]);
    expect(readFileSync(config, "utf8")).toBe(original);
    expect(existsSync(join(root(scope), ".aider/conventions/foo.md"))).toBe(true);
    expect(existsSync(join(root(scope), ".aider/conventions/bar.md"))).toBe(true);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["aider"]);
  });

  it.each([false, true])("visibly refuses an extra read directory (also owns a copy=%s)", async (ownsCopy) => {
    lock(scope, ["cursor", "claude-code"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    if (ownsCopy) file(scope, ".cursor/skills/foo/SKILL.md");
    const result = await remove(scope, ["cursor"]);
    expect(result.removed).toEqual([]);
    expect(result.errors[0].message).toContain(join(root(scope), ".claude/skills/foo"));
    expect(result.errors[0].message).toContain("Remove it from claude-code instead");
    expect(existsSync(join(root(scope), ".claude/skills/foo/SKILL.md"))).toBe(true);
    expect(existsSync(join(root(scope), ".cursor/skills/foo/SKILL.md"))).toBe(ownsCopy);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["cursor", "claude-code"]);
  });

  it("retains the receipt and installed agent when removing a native copy leaves converted output", async () => {
    const rule = scope === "project" ? ".windsurf/rules/foo.md" : ".codeium/windsurf/rules/foo.md";
    lock(scope, ["claude-code", "windsurf"]);
    file(scope, ".claude/skills/foo/SKILL.md");
    file(scope, rule);
    expect((await remove(scope, ["claude-code"])).errors).toEqual([]);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["windsurf"]);
  });

  it("includes converted output in an explicit remove-all and retains neighboring rules", async () => {
    const rule = scope === "project" ? ".windsurf/rules/foo.md" : ".codeium/windsurf/rules/foo.md";
    lock(scope, ["windsurf", "cline"]);
    file(scope, rule);
    file(scope, rule.replace("foo", "bar"));
    file(scope, ".cline/skills/foo/SKILL.md");
    expect((await remove(scope, [], true)).errors).toEqual([]);
    expect(existsSync(join(root(scope), rule))).toBe(false);
    expect(existsSync(join(root(scope), rule.replace("foo", "bar")))).toBe(true);
    expect((await state()).scopes[scope].installed).toBe(false);
    expect((await state("o/r/bar")).scopes[scope].installedAgentTools).toEqual(["windsurf"]);
  });

  it("refuses linked converted-output parents while preserving the effective rule and receipt", async () => {
    lock(scope, ["continue"]);
    file(scope, "shared-rules/foo.md");
    mkdirSync(join(root(scope), ".continue"));
    symlinkSync("../shared-rules", join(root(scope), ".continue/rules"), "dir");
    const result = await remove(scope, ["continue"]);
    expect(result.removed).toEqual([]);
    expect(result.errors[0].message).toContain("linked parent");
    expect(existsSync(join(root(scope), "shared-rules/foo.md"))).toBe(true);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["continue"]);
  });

  it("unlinks a converted leaf symlink without deleting its target", async () => {
    lock(scope, ["continue"]);
    file(scope, "shared-rules/foo.md");
    mkdirSync(join(root(scope), ".continue/rules"), { recursive: true });
    symlinkSync("../../shared-rules/foo.md", join(root(scope), ".continue/rules/foo.md"));
    expect((await remove(scope, ["continue"])).errors).toEqual([]);
    expect(existsSync(join(root(scope), "shared-rules/foo.md"))).toBe(true);
    expect((await state()).scopes[scope].installed).toBe(false);
  });

  it.each([false, true])("never follows a parent alias into the other scope (all=%s)", async (all) => {
    const other = scope === "project" ? "user" : "project";
    lock(scope, ["codex", "cline"]);
    file(scope, ".agents/skills/foo/SKILL.md");
    file(scope, ".agents/skills/bar/SKILL.md");
    lock(other, ["codex"]);
    file(other, ".agents/skills/foo/SKILL.md");
    file(other, ".agents/skills/bar/SKILL.md");
    const otherReceipt = JSON.stringify(readLockfile(lockDir(other)));
    mkdirSync(join(root(scope), ".cline"));
    symlinkSync(join(root(other), ".agents/skills"), join(root(scope), ".cline/skills"), "dir");
    const result = await remove(scope, ["codex", "cline"], all);
    expect(result.errors).toContainEqual(expect.objectContaining({ agentId: "cline", message: expect.stringContaining("linked parent") }));
    expect(readFileSync(join(root(other), ".agents/skills/foo/SKILL.md"), "utf8")).toContain("Fixture only.");
    expect(readFileSync(join(root(other), ".agents/skills/bar/SKILL.md"), "utf8")).toContain("Fixture only.");
    expect(JSON.stringify(readLockfile(lockDir(other)))).toBe(otherReceipt);
    expect((await state()).scopes[other].installedAgentTools).toEqual(["codex"]);
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["cline"]);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
  });
});

it("keeps user and project file evidence separate", async () => {
  lock("project", ["claude-code", "cline"]);
  lock("user", ["claude-code", "cline"]);
  file("project", ".claude/skills/foo/SKILL.md");
  file("user", ".cline/skills/foo/SKILL.md");
  const result = await state();
  expect(result.scopes.project.installedAgentTools).toEqual(["claude-code"]);
  expect(result.scopes.user.installedAgentTools).toEqual(["cline"]);
});

it("honors Antigravity's user override without treating its project-only shared flag as global", async () => {
  const override = join(mocks.home, "configured-skills");
  vi.stubEnv("VSKILL_ANTIGRAVITY_SKILLS_DIR", override);
  lock("user", ["antigravity"]);
  file("user", ".agents/skills/foo/SKILL.md");
  expect((await state()).scopes.user.installed).toBe(false);
  file("user", "configured-skills/foo/SKILL.md");
  expect((await state()).scopes.user.installedAgentTools).toEqual(["antigravity"]);
});

describe.each(["project", "user"] as const)("0850 safety review in %s scope", (scope) => {
  it.each([
    ["cline", ".cline/skills", false], ["cline", ".cline/skills", true],
    ["codex", ".agents/skills", false], ["codex", ".agents/skills", true],
  ] as const)("refuses %s linked parent %s (all=%s) and preserves outside bytes and receipt", async (agent, skillsDir, all) => {
    lock(scope, [agent]);
    const external = join(fixture, "external");
    mkdirSync(join(external, "foo"), { recursive: true });
    mkdirSync(join(external, "bar"));
    writeFileSync(join(external, "foo/SKILL.md"), "OUTSIDE FOO");
    writeFileSync(join(external, "bar/SKILL.md"), "OUTSIDE BAR");
    mkdirSync(join(root(scope), skillsDir, ".."), { recursive: true });
    symlinkSync(external, join(root(scope), skillsDir), "dir");
    expect((await state()).scopes[scope].installedAgentTools).toEqual([agent]);
    const result = await remove(scope, [agent], all);
    expect(existsSync(join(external, "foo/SKILL.md"))).toBe(true);
    expect(readFileSync(join(external, "foo/SKILL.md"), "utf8")).toBe("OUTSIDE FOO");
    expect(readFileSync(join(external, "bar/SKILL.md"), "utf8")).toBe("OUTSIDE BAR");
    expect(result.removed).toEqual([]);
    expect(result.errors.some((error: { message: string }) => error.message.includes("linked parent"))).toBe(true);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual([agent]);
  });

  it.each([
    ["cline", ".cline/skills", false], ["cline", ".cline/skills", true],
    ["codex", ".agents/skills", false], ["codex", ".agents/skills", true],
  ] as const)("unlinks only a valid %s leaf symlink under %s (all=%s)", async (agent, skillsDir, all) => {
    lock(scope, [agent]);
    const external = join(fixture, "external-leaf");
    mkdirSync(external);
    writeFileSync(join(external, "SKILL.md"), "PRESERVE TARGET");
    mkdirSync(join(root(scope), skillsDir), { recursive: true });
    symlinkSync(external, join(root(scope), skillsDir, "foo"), "dir");
    expect((await state()).scopes[scope].installedAgentTools).toEqual([agent]);
    const result = await remove(scope, [agent], all);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(root(scope), skillsDir, "foo"))).toBe(false);
    expect(readFileSync(join(external, "SKILL.md"), "utf8")).toBe("PRESERVE TARGET");
    expect((await state()).scopes[scope].installed).toBe(false);
  });
});

it.each([false, true])("0850 safety review removes Antigravity's effective fallback despite an empty preferred legacy dir (all=%s)", async (all) => {
  lock("user", ["antigravity"]);
  file("user", ".gemini/config/skills/foo/SKILL.md");
  file("user", ".gemini/config/skills/bar/SKILL.md");
  mkdirSync(join(mocks.home, ".gemini/antigravity/skills"), { recursive: true });
  expect((await state()).scopes.user.installedAgentTools).toEqual(["antigravity"]);
  const result = await remove("user", ["antigravity"], all);
  expect(result.errors).toEqual([]);
  expect(existsSync(join(mocks.home, ".gemini/config/skills/foo/SKILL.md"))).toBe(false);
  expect(existsSync(join(mocks.home, ".gemini/config/skills/bar/SKILL.md"))).toBe(true);
  expect(readLockfile(lockDir("user"))?.skills.foo).toBeUndefined();
  expect((await state()).scopes.user.installed).toBe(false);
  expect((await state("o/r/bar")).scopes.user.installedAgentTools).toEqual(["antigravity"]);
});

it.each([false, true])("0850 safety review removes all owned Antigravity copies, including override/default/legacy (all=%s)", async (all) => {
  lock("user", ["antigravity"]);
  vi.stubEnv("VSKILL_ANTIGRAVITY_SKILLS_DIR", join(mocks.home, "configured-skills"));
  const dirs = ["configured-skills", ".gemini/config/skills", ".gemini/antigravity/skills"];
  for (const dir of dirs) {
    file("user", `${dir}/foo/SKILL.md`);
    file("user", `${dir}/bar/SKILL.md`);
  }
  const result = await remove("user", ["antigravity"], all);
  expect(result.errors).toEqual([]);
  for (const dir of dirs) {
    expect(existsSync(join(mocks.home, dir, "foo/SKILL.md"))).toBe(false);
    expect(existsSync(join(mocks.home, dir, "bar/SKILL.md"))).toBe(true);
  }
  expect((await state()).scopes.user.installed).toBe(false);
  expect((await state("o/r/bar")).scopes.user.installedAgentTools).toEqual(["antigravity"]);
});

it.each([false, true])("0850 safety review refuses an unsafe Antigravity alternative before removing a safe copy (all=%s)", async (all) => {
  lock("user", ["antigravity"]);
  file("user", ".gemini/config/skills/foo/SKILL.md");
  const external = join(fixture, "external-antigravity");
  mkdirSync(join(external, "foo"), { recursive: true });
  writeFileSync(join(external, "foo/SKILL.md"), "PRESERVE OUTSIDE");
  mkdirSync(join(mocks.home, ".gemini/antigravity"), { recursive: true });
  symlinkSync(external, join(mocks.home, ".gemini/antigravity/skills"), "dir");
  const result = await remove("user", ["antigravity"], all);
  expect(result.removed).toEqual([]);
  expect(result.errors[0].message).toContain("linked parent");
  expect(readFileSync(join(external, "foo/SKILL.md"), "utf8")).toBe("PRESERVE OUTSIDE");
  expect(existsSync(join(mocks.home, ".gemini/config/skills/foo/SKILL.md"))).toBe(true);
  expect(readLockfile(lockDir("user"))?.skills.foo).toBeDefined();
  expect((await state()).scopes.user.installedAgentTools).toEqual(["antigravity"]);
});

describe.each(["project", "user"] as const)("0850 canonical dependencies in %s scope", (scope) => {
  function alias(path: string, target: string, directory = false) {
    mkdirSync(join(root(scope), path, ".."), { recursive: true });
    symlinkSync(join(root(scope), target), join(root(scope), path), directory ? "dir" : "file");
  }
  function canonical(agents: string[]) {
    lock(scope, ["codex", ...agents]);
    file(scope, ".agents/skills/foo/SKILL.md");
    file(scope, ".agents/skills/bar/SKILL.md");
  }
  async function preserved(agents: string[], result: any) {
    expect(result.removed).toEqual([]);
    expect(result.errors.length > 0 || result.skipped.length > 0).toBe(true);
    expect(readFileSync(join(root(scope), ".agents/skills/foo/SKILL.md"), "utf8")).toContain("Fixture only.");
    expect(readFileSync(join(root(scope), ".agents/skills/bar/SKILL.md"), "utf8")).toContain("Fixture only.");
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeDefined();
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["codex", ...agents]);
  }

  it.each([
    ["cline", ".cline/skills", ".agents/skills", true],
    ["cline", ".cline/skills/foo", ".agents/skills/foo", true],
    ["cline", ".cline/skills/foo/SKILL.md", ".agents/skills/foo/SKILL.md", false],
    ["continue", ".continue/rules/foo.md", ".agents/skills/foo/SKILL.md", false],
  ] as const)("protects an unselected %s reader through %s", async (agent, path, target, directory) => {
    canonical([agent]);
    alias(path, target, directory);
    expect((await state()).scopes[scope].installedAgentTools).toEqual(["codex", agent]);
    const result = await remove(scope, ["codex"]);
    expect(result.skipped[0].sharedWith).toContain(agent);
    await preserved([agent], result);
  });

  it("protects a converted reader of another file within the canonical skill root", async () => {
    canonical(["continue"]);
    file(scope, ".agents/skills/foo/rules.md");
    alias(".continue/rules/foo.md", ".agents/skills/foo/rules.md");
    await preserved(["continue"], await remove(scope, ["codex"]));
  });

  it.each([false, true])("rechecks a selected reader after its unlink fails (all=%s)", async (all) => {
    canonical(["cursor"]);
    alias(".cursor/skills/foo", ".agents/skills/foo", true);
    mocks.failUnlink = join(root(scope), ".cursor/skills/foo");
    const result = await remove(scope, ["codex", "cursor"], all);
    expect(result.errors).toContainEqual({ agentId: "cursor", message: "fixture unlink failure" });
    await preserved(["cursor"], result);
  });

  it.each([false, true])("a selected reader refused for a linked parent still protects canonical (all=%s)", async (all) => {
    canonical(["cline"]);
    alias(".cline/skills", ".agents/skills", true);
    const result = await remove(scope, ["codex", "cline"], all);
    expect(result.errors).toContainEqual(expect.objectContaining({ agentId: "cline", message: expect.stringContaining("linked parent") }));
    await preserved(["cline"], result);
  });

  it.each([false, true])("a selected converted reader refused for shared configuration still protects canonical (all=%s)", async (all) => {
    canonical(["aider"]);
    alias(".aider/conventions/foo.md", ".agents/skills/foo/SKILL.md");
    file(scope, ".aider.conf.yml");
    const result = await remove(scope, ["codex", "aider"], all);
    expect(result.errors).toContainEqual(expect.objectContaining({ agentId: "aider", message: expect.stringContaining("shared configuration") }));
    await preserved(["aider"], result);
  });

  it.each([false, true])("a selected shared reader whose own removal is unsafe still protects canonical (all=%s)", async (all) => {
    canonical(["cursor"]);
    alias(".cursor/skills", ".agents/skills", true);
    const result = await remove(scope, ["codex", "cursor"], all);
    expect(result.errors).toContainEqual(expect.objectContaining({ agentId: "cursor", message: expect.stringContaining("linked parent") }));
    await preserved(["cursor"], result);
  });

  it.each([false, true])("remaining extra read aliases protect canonical even when the reader is selected (all=%s)", async (all) => {
    canonical(["antigravity"]);
    alias(scope === "project" ? ".agent/skills" : ".gemini/antigravity-cli/skills", ".agents/skills", true);
    await preserved(["antigravity"], await remove(scope, ["codex", "antigravity"], all));
  });

  it.each([
    ["cline", ".cline/skills/foo", true, false],
    ["cline", ".cline/skills/foo", true, true],
    ["cline", ".cline/skills/foo/SKILL.md", false, false],
    ["cline", ".cline/skills/foo/SKILL.md", false, true],
    ["continue", ".continue/rules/foo.md", false, false],
    ["continue", ".continue/rules/foo.md", false, true],
    ["cursor", ".cursor/skills/foo", true, false],
    ["cursor", ".cursor/skills/foo", true, true],
  ] as const)("removes selected safe %s alias %s before canonical (directory=%s, all=%s)", async (agent, path, directory, all) => {
    canonical([agent]);
    alias(path, directory ? ".agents/skills/foo" : ".agents/skills/foo/SKILL.md", directory);
    const result = await remove(scope, ["codex", agent], all);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(existsSync(join(root(scope), ".agents/skills/foo"))).toBe(false);
    expect(existsSync(join(root(scope), path))).toBe(false);
    expect(existsSync(join(root(scope), ".agents/skills/bar/SKILL.md"))).toBe(true);
    expect(readLockfile(lockDir(scope))?.skills.foo).toBeUndefined();
    expect((await state()).scopes[scope].installed).toBe(false);
  });
});
