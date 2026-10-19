// 0932 T-03: `install <short-name> -y` auto-selects only an exact skill-slug
// match (AC-05), and an object-typed marketplace `plugin.source` is skipped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeNetwork, type FakeNetworkOptions, type FakeRepo } from "./helpers/fake-network.js";

const state = vi.hoisted(() => ({
  lock: null as null | { skills: Record<string, Record<string, unknown>>; agents: string[] },
  installed: [] as string[],
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
vi.mock("../../installer/multi-install.js", () => ({
  installSkillToAgents: (o: { skillName: string }) => {
    state.installed.push(o.skillName);
    return [`/project/.claude/skills/${o.skillName}`];
  },
}));
vi.mock("../../lockfile/index.js", () => ({
  readLockfile: () => state.lock,
  ensureLockfile: () => (state.lock ??= { skills: {}, agents: [] }),
  writeLockfile: () => {},
  removeSkillFromLock: () => {},
}));
vi.mock("../../blocklist/blocklist.js", () => ({
  checkInstallSafety: async () => ({ blocked: false, rejected: false, tainted: false }),
  checkLocalInstallSafety: async () => ({ blocked: false, rejected: false, tainted: false }),
}));

const SHA = "a".repeat(40);
const md = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`;

function result(owner: string, repo: string, skill: string) {
  return {
    name: skill, author: owner, ownerSlug: owner, repoSlug: repo, skillSlug: skill,
    repoUrl: `https://github.com/${owner}/${repo}`, certTier: "VERIFIED", trustScore: 80,
  };
}

const specweave: FakeRepo = {
  owner: "anton-abyzov", repo: "specweave", defaultBranch: "develop", headSha: SHA,
  commits: { [SHA]: { "skills/sw-do/SKILL.md": md("sw-do") } },
};
const kwp: FakeRepo = {
  owner: "anthropics", repo: "knowledge-work-plugins", defaultBranch: "main", headSha: SHA,
  commits: { [SHA]: { "skills/inbox-sweep/SKILL.md": md("inbox-sweep") } },
};
const fork: FakeRepo = { ...specweave, owner: "someone" };

let out: string[];
let net: ReturnType<typeof createFakeNetwork>;
function useNetwork(opts: FakeNetworkOptions) {
  net = createFakeNetwork(opts);
  vi.stubGlobal("fetch", net.fetch);
}

beforeEach(() => {
  vi.resetModules();
  state.lock = null;
  state.installed = [];
  out = [];
  const capture = (...a: unknown[]) => void out.push(a.join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function install(source: string, opts: Record<string, unknown> = { yes: true }) {
  const { addCommand } = await import("../add.js");
  await addCommand(source, opts);
}

describe("AC-05: -y auto-selects only an exact skill-slug match", () => {
  it("exits 1 listing the candidates when nothing is named exactly", async () => {
    useNetwork({
      repos: [kwp],
      search: { "sw-do": [result("anthropics", "knowledge-work-plugins", "inbox-sweep"), result("acme", "x", "sweep-do")] },
    });
    await expect(install("sw-do")).rejects.toThrow("exit:1");
    const text = out.join("\n");
    expect(text).toContain('No skill is named exactly "sw-do"');
    expect(text).toContain("anthropics/knowledge-work-plugins/inbox-sweep");
    expect(text).toContain("acme/x/sweep-do");
    expect(state.installed).toHaveLength(0);
  });

  it("does not install a single fuzzy hit either", async () => {
    useNetwork({ repos: [kwp], search: { "sw-do": [result("anthropics", "knowledge-work-plugins", "inbox-sweep")] } });
    await expect(install("sw-do")).rejects.toThrow("exit:1");
    expect(state.installed).toHaveLength(0);
  });

  it("installs the exact match even when it is not ranked first", async () => {
    useNetwork({
      repos: [kwp, specweave],
      search: { "sw-do": [result("anthropics", "knowledge-work-plugins", "inbox-sweep"), result("anton-abyzov", "specweave", "sw-do")] },
    });
    await install("sw-do");
    expect(state.installed).toEqual(["sw-do"]);
    expect(state.lock!.skills["sw-do"].source).toBe("github:anton-abyzov/specweave");
  });

  it("exits 1 when several repos publish the exact name", async () => {
    useNetwork({
      repos: [specweave, fork],
      search: { "sw-do": [result("anton-abyzov", "specweave", "sw-do"), result("someone", "specweave", "sw-do")] },
    });
    await expect(install("sw-do")).rejects.toThrow("exit:1");
    const text = out.join("\n");
    expect(text).toContain('Several repos publish "sw-do"');
    expect(text).toContain("anton-abyzov/specweave/sw-do");
    expect(text).toContain("someone/specweave/sw-do");
    expect(state.installed).toHaveLength(0);
  });
});

describe("AC-05: an object-typed plugin.source is skipped, not thrown", () => {
  const marketplace = JSON.stringify({
    name: "mixed",
    plugins: [
      { name: "remote", source: { source: "github", repo: "other/repo" } },
      { name: "local", source: "./plugins/local" },
    ],
  });
  const mixed: FakeRepo = {
    owner: "acme", repo: "mixed", defaultBranch: "main", headSha: SHA, marketplace,
    commits: { [SHA]: { "plugins/local/skills/greet/SKILL.md": md("greet") } },
  };

  it("finds a skill inside a local plugin past an object-source plugin", async () => {
    useNetwork({ repos: [mixed] });
    await install("acme/mixed/greet");
    expect(state.installed).toEqual(["greet"]);
  });

  it("skips a selected plugin whose source lives in another repo", async () => {
    useNetwork({ repos: [mixed] });
    await install("acme/mixed/remote").catch((err: Error) => {
      // A clean exit is fine; a TypeError from `.replace` on an object is not.
      expect(err.message).toMatch(/^exit:/);
    });
    expect(out.join("\n")).toContain("Skipping remote");
    expect(out.join("\n")).not.toMatch(/replace is not a function/);
  });
});
