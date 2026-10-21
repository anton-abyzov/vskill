// 0850 F6: use real lockfiles, skill files, and remove handlers in isolated
// fixtures. No installed user skills or real home directory are accessed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({ home: "", sendJson: vi.fn(), readBody: vi.fn() }));
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
