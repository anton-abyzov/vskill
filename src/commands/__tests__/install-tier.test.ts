// 0932 T-02: the lock tier comes from the registry (AC-03) and the platform
// security gate looks the skill up by owner/repo/skill (AC-04).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFakeNetwork, sha256, type FakeNetworkOptions, type FakeRepo } from "./helpers/fake-network.js";

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

const SHA_V1 = "1".repeat(40);
const SHA_HEAD = "3".repeat(40);
const skillMd = (v: string, body = "Greet") => `---\nname: greet\ndescription: Greets\nversion: ${v}\n---\n# ${body}\n`;

function repo(headContent: string): FakeRepo {
  return {
    owner: "acme",
    repo: "skills",
    defaultBranch: "develop",
    headSha: SHA_HEAD,
    commits: {
      [SHA_V1]: { "skills/greet/SKILL.md": skillMd("1.0.0") },
      [SHA_HEAD]: { "skills/greet/SKILL.md": headContent },
    },
  };
}

let net: ReturnType<typeof createFakeNetwork>;
let out: string[];

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

const registry = {
  "acme/skills/greet": [
    { version: "1.1.0", gitSha: "2".repeat(40), contentHash: sha256(skillMd("1.1.0", "Greet v1.1")) },
    { version: "1.0.0", gitSha: SHA_V1, contentHash: sha256(skillMd("1.0.0")) },
  ],
};

async function install(source: string, opts: Record<string, unknown> = {}) {
  const { addCommand } = await import("../add.js");
  await addCommand(source, { yes: true, ...opts });
}

describe("AC-03: lock tier comes from the registry", () => {
  it("records UNSCANNED and names the registry's latest version when HEAD differs", async () => {
    useNetwork({ repos: [repo(skillMd("3.1.0", "Greet HEAD"))], registry });
    await install("acme/skills/greet");
    expect(state.lock!.skills.greet.tier).toBe("UNSCANNED");
    expect(out.join("\n")).toContain("latest on verified-skill.com: 1.1.0");
  });

  it("records VERIFIED when the installed SKILL.md hashes to a published version", async () => {
    useNetwork({ repos: [repo(skillMd("1.1.0", "Greet v1.1"))], registry });
    await install("acme/skills/greet");
    expect(state.lock!.skills.greet.tier).toBe("VERIFIED");
  });

  it("matches the registry's canonical hash (top-level version stripped, CRLF normalised)", async () => {
    const canonical = "---\nname: greet\ndescription: Greets\n---\n# Greet\n";
    useNetwork({
      repos: [repo("---\nversion: 9.9.9\nname: greet\ndescription: Greets\n---\n# Greet\n".replace(/\n/g, "\r\n"))],
      registry: { "acme/skills/greet": [{ version: "2.0.0", gitSha: SHA_HEAD, contentHash: `sha256:${sha256(canonical)}` }] },
    });
    await install("acme/skills/greet");
    expect(state.lock!.skills.greet.tier).toBe("VERIFIED");
  });

  it("records UNSCANNED with a one-line note when the registry is unreachable", async () => {
    useNetwork({ repos: [repo(skillMd("1.0.0"))], registry, registryDown: true });
    await install("acme/skills/greet");
    expect(state.lock!.skills.greet.tier).toBe("UNSCANNED");
    expect(out.join("\n")).toContain("verified-skill.com could not be reached");
  });

  it("has no hardcoded VERIFIED tier left in the install paths", () => {
    for (const file of ["../add.ts", "../add-lockfile.ts"]) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(text).not.toMatch(/tier:\s*(?:[^,\n]*\?\s*)?"VERIFIED"/);
    }
  });
});

describe("AC-04: platform security check uses owner/repo/skill", () => {
  const critical = {
    overallVerdict: "FAIL",
    reportUrl: "/skills/acme/skills/greet/security",
    providers: [{ provider: "snyk", status: "FAIL", verdict: "FAIL", criticalCount: 2 }],
  };

  it("blocks the install with exit 1 on a CRITICAL report for the full name", async () => {
    useNetwork({ repos: [repo(skillMd("1.0.0"))], registry, security: { "acme/skills/greet": critical } });
    await expect(install("acme/skills/greet")).rejects.toThrow("exit:1");
    expect(state.installed).toHaveLength(0);
    expect(state.lock).toBeNull();
    expect(out.join("\n")).toContain("BLOCKED: External security scan found CRITICAL findings");
    expect(net.calls.some((u) => u.endsWith("/api/v1/skills/acme/skills/greet/security"))).toBe(true);
    expect(net.calls.some((u) => /\/api\/v1\/skills\/greet\/security$/.test(u))).toBe(false);
  });

  it("blocks a skill installed from a multi-skill repo the same way", async () => {
    useNetwork({ repos: [repo(skillMd("1.0.0"))], registry, security: { "acme/skills/greet": critical } });
    await install("acme/skills");
    expect(state.installed).toHaveLength(0);
    expect(out.join("\n")).toContain("SECURITY_FAIL");
  });

  it("--force installs despite CRITICAL findings and warns", async () => {
    useNetwork({ repos: [repo(skillMd("1.0.0"))], registry, security: { "acme/skills/greet": critical } });
    await install("acme/skills/greet", { force: true });
    expect(state.installed).toEqual(["greet"]);
    expect(out.join("\n")).toContain("--force: proceeding despite CRITICAL findings");
  });
});
