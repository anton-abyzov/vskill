// ---------------------------------------------------------------------------
// End-to-end egress check for private skills: real lockfile on disk, real
// commands, real API client, only `fetch` mocked. Asserts that no request to
// verified-skill.com carries anything about a skill from a private GitHub repo
// — neither one GitHub reports as private nor one whose visibility cannot be
// confirmed (404 without access) — and never a raw GitHub token.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLATFORM = "https://platform.test";
const GITHUB_TOKEN = "gho_repo_scoped_token_1234567890";
const projectDir = vi.hoisted(() => ({ path: "" }));

vi.mock("../../lockfile/project-root.js", () => ({
  getProjectRoot: () => projectDir.path,
  findProjectRoot: () => projectDir.path,
}));

vi.mock("../../agents/agents-registry.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    detectInstalledAgents: async () => [
      {
        id: "claude-code",
        displayName: "Claude Code",
        localSkillsDir: ".claude/skills",
        globalSkillsDir: "~/.claude/skills",
      },
    ],
  };
});

// Nothing in these flows should install; keep the canonical installer inert.
vi.mock("../../installer/canonical.js", () => ({ installSymlink: vi.fn() }));

const { _setKeychainForTests, _resetClientAuthCacheForTests } = await import("../../api/client.js");
const { _resetRepoVisibilityForTests } = await import("../repo-visibility.js");
const { _resetBranchCache } = await import("../../discovery/github-tree.js");
const { getOutdatedJson, postInstallHint } = await import("../../commands/outdated.js");
const { updateCommand } = await import("../../commands/update.js");
const { pinCommand } = await import("../../commands/pin.js");
const { versionsCommand } = await import("../../commands/versions.js");
const { diffCommand } = await import("../../commands/diff.js");
const { readLockfile } = await import("../../lockfile/lockfile.js");

const PRIVATE_MARKERS = ["secret-skills", "resume-tuner", "flagged-private", "hidden-skill", GITHUB_TOKEN];

interface Call {
  url: string;
  body: string;
  auth: string | undefined;
}
let calls: Call[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  calls.push({
    url,
    body: typeof init?.body === "string" ? init.body : "",
    auth: headers.get("authorization") ?? undefined,
  });
  if (url === "https://api.github.com/repos/acme/secret-skills") {
    // No access → GitHub hides the repo: visibility unknown.
    return Promise.resolve(jsonResponse(404, { message: "Not Found" }));
  }
  if (url === "https://api.github.com/repos/acme/flagged-private") {
    return Promise.resolve(jsonResponse(200, { default_branch: "main", private: true, visibility: "private" }));
  }
  if (url === "https://api.github.com/repos/acme/open-skills") {
    return Promise.resolve(jsonResponse(200, { default_branch: "main", private: false, visibility: "public" }));
  }
  if (url.startsWith("https://api.github.com/") || url.startsWith("https://raw.githubusercontent.com/")) {
    return Promise.resolve(jsonResponse(404, { message: "Not Found" }));
  }
  if (url.startsWith(PLATFORM)) {
    return Promise.resolve(jsonResponse(200, { results: [], versions: [], files: [] }));
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`));
}

function platformCalls(): Call[] {
  return calls.filter((c) => c.url.startsWith(PLATFORM));
}

function expectNoPrivateDataSent(): void {
  for (const c of platformCalls()) {
    for (const marker of PRIVATE_MARKERS) {
      expect(c.url, `platform URL leaks ${marker}`).not.toContain(marker);
      expect(c.body, `platform body leaks ${marker}`).not.toContain(marker);
    }
    expect(c.auth ?? "").not.toContain(GITHUB_TOKEN);
  }
}

function writeLock(): void {
  const lock = {
    version: 1,
    agents: ["claude-code"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skills: {
      // Pre-1.2.0 style entry: visibility never recorded.
      "resume-tuner": {
        version: "1.0.0",
        sha: "a".repeat(64),
        tier: "VERIFIED",
        installedAt: "2026-01-01T00:00:00.000Z",
        source: "github:acme/secret-skills",
        sourceType: "github",
        sourceRepoUrl: "https://github.com/acme/secret-skills",
        sourceSkillPath: "skills/resume-tuner/SKILL.md",
      },
      "hidden-skill": {
        version: "1.0.0",
        sha: "b".repeat(64),
        tier: "VERIFIED",
        installedAt: "2026-01-01T00:00:00.000Z",
        source: "github:acme/flagged-private",
        sourceType: "github",
      },
      "open-skill": {
        version: "1.0.0",
        sha: "c".repeat(64),
        tier: "VERIFIED",
        installedAt: "2026-01-01T00:00:00.000Z",
        source: "github:acme/open-skills",
        sourceType: "github",
      },
      "reg-skill": {
        version: "1.0.0",
        sha: "d".repeat(64),
        tier: "VERIFIED",
        installedAt: "2026-01-01T00:00:00.000Z",
        source: "registry:reg-skill",
      },
    },
  };
  writeFileSync(join(projectDir.path, "vskill.lock"), JSON.stringify(lock, null, 2));
}

const originalFetch = globalThis.fetch;
const originalBase = process.env.VSKILL_API_BASE;
const originalGhToken = process.env.VSKILL_GITHUB_TOKEN;

beforeEach(() => {
  projectDir.path = mkdtempSync(join(tmpdir(), "vskill-egress-"));
  writeLock();
  calls = [];
  process.env.VSKILL_API_BASE = PLATFORM;
  // The GitHub token reaches GitHub (and only GitHub) via VSKILL_GITHUB_TOKEN.
  process.env.VSKILL_GITHUB_TOKEN = GITHUB_TOKEN;
  globalThis.fetch = vi.fn(fakeFetch) as unknown as typeof fetch;
  // The same token is in the keychain, as after `vskill auth login --repos`.
  _setKeychainForTests({
    getGitHubToken: () => GITHUB_TOKEN,
    getVskillToken: () => null,
  } as never);
  _resetClientAuthCacheForTests();
  _resetRepoVisibilityForTests();
  _resetBranchCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  _setKeychainForTests(null);
  _resetClientAuthCacheForTests();
  rmSync(projectDir.path, { recursive: true, force: true });
});

afterAll(() => {
  if (originalBase === undefined) delete process.env.VSKILL_API_BASE;
  else process.env.VSKILL_API_BASE = originalBase;
  if (originalGhToken === undefined) delete process.env.VSKILL_GITHUB_TOKEN;
  else process.env.VSKILL_GITHUB_TOKEN = originalGhToken;
});

describe("private skills never reach verified-skill.com", () => {
  it("outdated sends only public and registry skills to check-updates", async () => {
    await getOutdatedJson();

    const checks = platformCalls().filter((c) => c.url.endsWith("/api/v1/skills/check-updates"));
    expect(checks).toHaveLength(1);
    const names = (JSON.parse(checks[0].body).skills as Array<{ name: string }>).map((s) => s.name);
    expect(names).toEqual(["acme/open-skills/open-skill", "reg-skill"]);
    expectNoPrivateDataSent();
  });

  it("the post-install update hint filters the same way", async () => {
    const lock = readLockfile(projectDir.path)!;
    await postInstallHint(lock, projectDir.path, []);

    const checks = platformCalls().filter((c) => c.url.endsWith("/api/v1/skills/check-updates"));
    expect(checks).toHaveLength(1);
    expect(checks[0].body).toContain("open-skill");
    expectNoPrivateDataSent();
  });

  it("update never asks the registry about a private or unconfirmed skill", async () => {
    await updateCommand(undefined, {});

    // The private skills were looked for on GitHub only.
    expect(calls.some((c) => c.url.includes("raw.githubusercontent.com/acme/secret-skills")
      || c.url.includes("api.github.com/repos/acme/secret-skills/contents"))).toBe(true);
    // The public GitHub skill still gets its registry fallback.
    expect(platformCalls().some((c) => c.url.endsWith("/api/v1/skills/open-skill"))).toBe(true);
    expectNoPrivateDataSent();
  });

  it("versions, versions --diff, pin and diff skip the platform for private skills", async () => {
    await versionsCommand("resume-tuner", {});
    await versionsCommand("acme/secret-skills/resume-tuner", { json: true });
    await versionsCommand("hidden-skill", { diff: true });
    await pinCommand("resume-tuner", "2.0.0");
    await expect(diffCommand("resume-tuner", "1.0.0", "2.0.0")).rejects.toThrow("process.exit(1)");

    expect(platformCalls()).toEqual([]);
    expect(readLockfile(projectDir.path)!.skills["resume-tuner"].pinnedVersion).toBe("2.0.0");
  });

  it("versions and diff recognise a private skill installed with --global", async () => {
    // The skill lives only in ~/.agents/vskill.lock; the project has none.
    const home = mkdtempSync(join(tmpdir(), "vskill-egress-home-"));
    const originalHome = process.env.HOME;
    try {
      mkdirSync(join(home, ".agents"), { recursive: true });
      renameSync(join(projectDir.path, "vskill.lock"), join(home, ".agents", "vskill.lock"));
      process.env.HOME = home;

      await versionsCommand("resume-tuner", {});
      await versionsCommand("hidden-skill", { json: true });
      await expect(diffCommand("resume-tuner", "1.0.0", "2.0.0")).rejects.toThrow("process.exit(1)");

      expect(platformCalls()).toEqual([]);
    } finally {
      process.env.HOME = originalHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("versions still asks the platform about a public skill", async () => {
    await versionsCommand("open-skill", { json: true });

    expect(platformCalls().map((c) => c.url)).toEqual([
      `${PLATFORM}/api/v1/skills/acme/open-skills/open-skill/versions`,
    ]);
    expectNoPrivateDataSent();
  });
});
