// 0932 T-05 (AC-07): `update` moves the lock's sourceCommitSha to the commit
// it read, and `outdated` reports a GitHub-sourced skill whose upstream
// SKILL.md hash differs, even when the registry (which lags) reports none.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createFakeNetwork, type FakeRepo } from "./helpers/fake-network.js";

type Lock = { version: number; agents: string[]; skills: Record<string, Record<string, unknown>>; createdAt: string };

const state = vi.hoisted(() => ({
  lock: null as null | Lock,
  written: null as null | Lock,
  registry: [] as Array<Record<string, unknown>>,
  installed: [] as Array<{ name: string; content: string }>,
}));

vi.mock("../../lib/keychain.js", () => ({
  getDefaultKeychain: () => ({ getGitHubToken: () => null, getVskillToken: () => null }),
}));
vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: async () => [
    { id: "claude-code", displayName: "Claude Code", localSkillsDir: ".claude/skills", globalSkillsDir: "~/.claude/skills" },
  ],
  AGENTS_REGISTRY: [],
}));
vi.mock("../../installer/canonical.js", () => ({
  installSymlink: (name: string, content: string) => {
    state.installed.push({ name, content });
    return [];
  },
}));
vi.mock("../../installer/migrate.js", () => ({ ensureSkillMdNaming: () => {} }));
vi.mock("../../lockfile/index.js", () => ({
  readLockfile: () => state.lock,
  writeLockfile: (lock: Lock) => {
    state.written = structuredClone(lock);
  },
}));
vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: () => state.lock,
  writeLockfile: () => {},
}));
vi.mock("../../lockfile/authored.js", () => ({ readAuthored: () => [], removeAuthoredSkill: () => {} }));
vi.mock("../../api/client.js", () => ({
  getSkill: async () => {
    throw new Error("not in registry");
  },
  checkUpdates: async (items: Array<{ name: string; currentVersion: string }>) =>
    items.map((i) => ({ name: i.name, installed: i.currentVersion, latest: i.currentVersion, updateAvailable: false, ...state.registry.find((r) => r.name === i.name) })),
}));

const OLD = "1".repeat(40);
const NEW = "2".repeat(40);
const md = (v: string, body: string) => `---\nname: sw-do\ndescription: Do\nversion: ${v}\n---\n# ${body}\n`;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

function repo(headSha: string): FakeRepo {
  return {
    owner: "anton-abyzov",
    repo: "specweave",
    defaultBranch: "develop",
    headSha,
    commits: {
      [OLD]: { "skills/sw-do/SKILL.md": md("3.0.0", "old") },
      [NEW]: { "skills/sw-do/SKILL.md": md("3.1.0", "new") },
    },
  };
}

function lockWith(content: string, commit: string): Lock {
  return {
    version: 1,
    agents: ["claude-code"],
    createdAt: "2026-10-01T00:00:00Z",
    skills: {
      "sw-do": {
        version: "3.0.0",
        sha: sha(content),
        tier: "UNSCANNED",
        installedAt: "2026-10-01T00:00:00Z",
        source: "github:anton-abyzov/specweave",
        sourceBranch: "develop",
        sourceSkillPath: "skills/sw-do/SKILL.md",
        sourceCommitSha: commit,
        files: ["SKILL.md"],
      },
    },
  };
}

let out: string[];
beforeEach(() => {
  vi.resetModules();
  state.lock = null;
  state.written = null;
  state.registry = [];
  state.installed = [];
  out = [];
  const capture = (...a: unknown[]) => void out.push(a.join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AC-07: update writes the new sourceCommitSha", () => {
  it("records the commit the new content came from", async () => {
    vi.stubGlobal("fetch", createFakeNetwork({ repos: [repo(NEW)] }).fetch);
    state.lock = lockWith(md("3.0.0", "old"), OLD);
    const { updateCommand } = await import("../update.js");
    await updateCommand(undefined, {});
    expect(state.installed.map((i) => i.name)).toEqual(["sw-do"]);
    const entry = state.written!.skills["sw-do"];
    expect(entry.sourceCommitSha).toBe(NEW);
    expect(entry.sha).toBe(sha(md("3.1.0", "new")));
  });

  it("moves a stale sourceCommitSha even when the content is unchanged", async () => {
    // The skill's content is the same at OLD and at HEAD (another file changed).
    const same: FakeRepo = { ...repo(NEW), commits: { [NEW]: { "skills/sw-do/SKILL.md": md("3.0.0", "old") } } };
    vi.stubGlobal("fetch", createFakeNetwork({ repos: [same] }).fetch);
    state.lock = lockWith(md("3.0.0", "old"), OLD);
    const { updateCommand } = await import("../update.js");
    await updateCommand(undefined, {});
    expect(state.installed).toEqual([]);
    expect(state.written!.skills["sw-do"].sourceCommitSha).toBe(NEW);
  });
});

describe("AC-07: outdated reports a changed GitHub source", () => {
  it("flags the skill when upstream SKILL.md differs and the registry says no update", async () => {
    vi.stubGlobal("fetch", createFakeNetwork({ repos: [repo(NEW)] }).fetch);
    state.lock = lockWith(md("3.0.0", "old"), OLD);
    const { getOutdatedJson } = await import("../outdated.js");
    const res = await getOutdatedJson();
    const row = res!.results.find((r) => r.name === "anton-abyzov/specweave/sw-do")!;
    expect(row.updateAvailable).toBe(true);
    expect(row.sourceChanged).toBe(true);
    expect(row.latest).toBe("3.1.0");
  });

  it("agrees with update when upstream is unchanged", async () => {
    vi.stubGlobal("fetch", createFakeNetwork({ repos: [repo(OLD)] }).fetch);
    state.lock = lockWith(md("3.0.0", "old"), OLD);
    const { getOutdatedJson } = await import("../outdated.js");
    const res = await getOutdatedJson();
    const row = res!.results.find((r) => r.name === "anton-abyzov/specweave/sw-do")!;
    expect(row.updateAvailable).toBe(false);
    expect(row.sourceChanged).toBeUndefined();
  });

  it("leaves a pinned skill alone", async () => {
    vi.stubGlobal("fetch", createFakeNetwork({ repos: [repo(NEW)] }).fetch);
    state.lock = lockWith(md("3.0.0", "old"), OLD);
    state.lock.skills["sw-do"].pinnedVersion = "3.0.0";
    const { getOutdatedJson } = await import("../outdated.js");
    const res = await getOutdatedJson();
    expect(res!.results.find((r) => r.name === "anton-abyzov/specweave/sw-do")!.updateAvailable).toBe(false);
  });
});
