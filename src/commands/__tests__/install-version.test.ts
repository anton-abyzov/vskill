// 0932 T-01: `install --version x` reaches install (AC-01), and
// `owner/repo/skill@x` installs the commit the registry recorded (AC-02).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createFakeNetwork, sha256, type FakeRepo } from "./helpers/fake-network.js";

const pkg = createRequire(import.meta.url)("../../../package.json") as { version: string };

const state = vi.hoisted(() => ({
  lock: null as null | { skills: Record<string, Record<string, unknown>>; agents: string[] },
  installed: [] as Array<{ skillName: string; rawContent: string }>,
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
  installSkillToAgents: (o: { skillName: string; rawContent: string }) => {
    state.installed.push({ skillName: o.skillName, rawContent: o.rawContent });
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

const SHA_V1 = "1".repeat(40);
const SHA_V2 = "2".repeat(40);
const SHA_HEAD = "3".repeat(40);
const skillMd = (v: string) => `---\nname: greet\ndescription: Greets\nversion: ${v}\n---\n# Greet ${v}\n`;

function repo(): FakeRepo {
  return {
    owner: "acme",
    repo: "skills",
    defaultBranch: "develop",
    headSha: SHA_HEAD,
    commits: {
      [SHA_V1]: { "skills/greet/SKILL.md": skillMd("1.0.0") },
      [SHA_V2]: { "skills/greet/SKILL.md": skillMd("1.1.0") },
      [SHA_HEAD]: { "skills/greet/SKILL.md": skillMd("3.1.0") },
    },
  };
}

let net: ReturnType<typeof createFakeNetwork>;
let errors: string[];
let logs: string[];

beforeEach(async () => {
  vi.resetModules();
  state.lock = null;
  state.installed = [];
  errors = [];
  logs = [];
  net = createFakeNetwork({
    repos: [repo()],
    registry: {
      "acme/skills/greet": [
        { version: "1.1.0", gitSha: SHA_V2, contentHash: sha256(skillMd("1.1.0")) },
        { version: "1.0.0", gitSha: SHA_V1, contentHash: sha256(skillMd("1.0.0")) },
      ],
    },
  });
  vi.stubGlobal("fetch", net.fetch);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../install-private.js");
  vi.doUnmock("../add.js");
});

async function runCli(args: string[]): Promise<{ stdout: string }> {
  const out: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as never);
  const prior = process.argv;
  process.argv = ["node", "vskill", ...args];
  try {
    await import("../../index.js");
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.argv = prior;
  }
  return { stdout: out.join("") };
}

describe("AC-01: install --version is not swallowed by the program version flag", () => {
  it("passes --version 1.0.0 (space form) to the private install with --tenant", async () => {
    const installPrivateCommand = vi.fn(async () => {});
    vi.doMock("../install-private.js", () => ({ installPrivateCommand }));
    const { stdout } = await runCli(["install", "--tenant", "t", "x", "--version", "1.0.0"]);
    expect(installPrivateCommand).toHaveBeenCalledTimes(1);
    const [source, opts] = installPrivateCommand.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(source).toBe("x");
    expect(opts.tenant).toBe("t");
    expect(opts.version).toBe("1.0.0");
    expect(stdout).not.toContain(pkg.version);
  });

  it("passes owner/repo/skill@1.0.0 to install as source + version", async () => {
    const addCommand = vi.fn(async () => {});
    vi.doMock("../add.js", () => ({ addCommand }));
    await runCli(["install", "acme/skills/greet@1.0.0", "-y"]);
    const [source, opts] = addCommand.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(source).toBe("acme/skills/greet");
    expect(opts.version).toBe("1.0.0");
  });

  it("still prints the CLI version for `vskill --version` and `vskill -v`", async () => {
    for (const flag of ["--version", "-v"]) {
      vi.resetModules();
      await expect(runCli([flag])).rejects.toThrow("exit:0");
      const written = (process.stdout.write as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => String(c[0]))
        .join("");
      expect(written).toContain(pkg.version);
    }
  });
});

describe("AC-02: owner/repo/skill@version installs the registry's commit", () => {
  it("reads SKILL.md at the recorded gitSha and pins the lock", async () => {
    const { addCommand } = await import("../add.js");
    await addCommand("acme/skills/greet@1.0.0", { yes: true });

    expect(state.installed).toHaveLength(1);
    expect(state.installed[0].rawContent).toContain("# Greet 1.0.0");
    const skillReads = net.rawCalls().filter((u) => u.endsWith("/skills/greet/SKILL.md"));
    expect(skillReads.length).toBeGreaterThan(0);
    expect(skillReads.every((u) => u.includes(`/${SHA_V1}/`))).toBe(true);

    const entry = state.lock!.skills.greet;
    expect(entry.version).toBe("1.0.0");
    expect(entry.pinnedVersion).toBe("1.0.0");
    expect(entry.sourceCommitSha).toBe(SHA_V1);
  });

  it("accepts --version on a public owner/repo/skill", async () => {
    const { addCommand } = await import("../add.js");
    await addCommand("acme/skills/greet", { yes: true, version: "1.1.0" });
    expect(state.installed[0].rawContent).toContain("# Greet 1.1.0");
    expect(state.lock!.skills.greet.sourceCommitSha).toBe(SHA_V2);
  });

  it("exits 1 for an unknown version and lists the available ones", async () => {
    const { addCommand } = await import("../add.js");
    await expect(addCommand("acme/skills/greet@9.9.9", { yes: true })).rejects.toThrow("exit:1");
    expect(errors.join("\n")).toContain("9.9.9");
    expect(errors.join("\n")).toContain("Available versions: 1.1.0, 1.0.0");
    expect(state.installed).toHaveLength(0);
  });
});

describe("AC-02: vskill pin prints a command that works", () => {
  it("names the full owner/repo/skill@version for a public GitHub skill", async () => {
    const { installCommandFor } = await import("../pin.js");
    const cmd = installCommandFor(
      "greet",
      { version: "1.1.0", sha: "x", tier: "UNSCANNED", installedAt: "", source: "github:acme/skills" },
      "1.0.0",
      false,
    );
    expect(cmd).toBe("vskill install acme/skills/greet@1.0.0");
    const { splitVersionSuffix } = await import("../../lib/registry-version.js");
    expect(splitVersionSuffix(cmd!.split(" ")[2])).toEqual({ source: "acme/skills/greet", version: "1.0.0" });
  });

  it("uses --tenant/--version for a hosted private skill and nothing for a private repo", async () => {
    const { installCommandFor } = await import("../pin.js");
    const hosted = {
      version: "1.0.0", sha: "x", tier: "SCANNED", installedAt: "", source: "hosted-private:t/x",
      hostedPrivate: { tenantId: "t", tenantSlug: "team", skillId: "s", skillSlug: "helpful", treeHash: "h", agents: [], agentFiles: {}, copy: false },
    };
    expect(installCommandFor("private-team-helpful", hosted as never, "1.0.1", true)).toBe(
      "vskill install --tenant team helpful --version 1.0.1",
    );
    expect(
      installCommandFor("greet", { version: "1", sha: "x", tier: "UNSCANNED", installedAt: "", source: "github:acme/secret" }, "1.0.0", true),
    ).toBeNull();
  });
});
