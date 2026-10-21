// 0850 F6: use real lockfiles, skill files, and remove handlers in isolated
// fixtures. No installed user skills or real home directory are accessed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
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
async function remove(scope: "project" | "user") {
  mocks.readBody.mockResolvedValueOnce({ skill: "o/r/foo", agentIds: ["cline"], scope });
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
