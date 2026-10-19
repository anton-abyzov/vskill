// 0932 T-04: one owner/repo/skill install stays inside the anonymous GitHub
// budget (AC-06), and a rate limit falls back to raw HEAD with a message that
// names the API limit instead of blaming a private repo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeNetwork,
  type FakeNetworkOptions,
  type FakeRepo,
} from "../../commands/__tests__/helpers/fake-network.js";

const state = vi.hoisted(() => ({
  lock: null as null | { skills: Record<string, Record<string, unknown>>; agents: string[] },
  installed: [] as Array<{ skillName: string; content: string }>,
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
  installSkillToAgents: (o: { skillName: string; content: string }) => {
    state.installed.push({ skillName: o.skillName, content: o.content });
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

const SHA = "d".repeat(40);
const md = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`;

const specweave: FakeRepo = {
  owner: "anton-abyzov",
  repo: "specweave",
  defaultBranch: "develop",
  headSha: SHA,
  commits: {
    [SHA]: {
      "skills/sw-do/SKILL.md": md("sw-do"),
      "skills/sw-do/agents/worker.md": "# worker\n",
      "skills/sw-done/SKILL.md": md("sw-done"),
      "skills/sw-increment/SKILL.md": md("sw-increment"),
      "skills/sw-review/SKILL.md": md("sw-review"),
      "README.md": "# specweave\n",
    },
  },
};

let net: ReturnType<typeof createFakeNetwork>;
let out: string[];

function useNetwork(opts: FakeNetworkOptions) {
  net = createFakeNetwork(opts);
  vi.stubGlobal("fetch", vi.fn(net.fetch));
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

async function install(source: string, opts: Record<string, unknown> = {}) {
  const { addCommand } = await import("../../commands/add.js");
  await addCommand(source, { yes: true, ...opts });
}

describe("AC-06: GitHub REST budget for one owner/repo/skill install", () => {
  it("makes at most 6 api.github.com calls", async () => {
    useNetwork({ repos: [specweave] });
    await install("anton-abyzov/specweave/sw-do");
    expect(state.installed.map((i) => i.skillName)).toEqual(["sw-do"]);
    const rest = net.githubRestCalls();
    expect(rest.length, rest.join("\n")).toBeLessThanOrEqual(6);
    expect(state.lock!.skills["sw-do"].sourceCommitSha).toBe(SHA);
  });
});

describe("AC-06: rate-limit fallback", () => {
  it("reads raw HEAD, not main, and says the API limit was hit", async () => {
    useNetwork({ repos: [specweave], rateLimited: true });
    await install("anton-abyzov/specweave/sw-do");
    expect(state.installed.map((i) => i.skillName)).toEqual(["sw-do"]);
    const raw = net.rawCalls();
    expect(raw.some((u) => u.includes("/anton-abyzov/specweave/HEAD/skills/sw-do/SKILL.md")), raw.join("\n")).toBe(true);
    expect(raw.some((u) => u.includes("/main/")), raw.join("\n")).toBe(false);
    const text = out.join("\n");
    expect(text).toMatch(/rate limit/i);
    expect(text).not.toMatch(/may be private|private repo/i);
  });

  it("names the rate limit, not a private repo, when the guessed path is missing", async () => {
    useNetwork({ repos: [specweave], rateLimited: true });
    await expect(install("anton-abyzov/specweave/sw-nope")).rejects.toThrow("exit:1");
    const text = out.join("\n");
    expect(text).toContain("The GitHub API rate limit was hit");
    expect(text).not.toMatch(/If this is a private repository/);
    expect(net.rawCalls().some((u) => u.includes("/main/"))).toBe(false);
  });
});
