// ---------------------------------------------------------------------------
// vskill 1.2.1 egress checks, same harness as private-source-egress.test.ts:
// real lockfile, real commands and API client, only `fetch` mocked.
//   - skills inside private plugins (lock entries keyed by plugin name)
//   - info / submit for private repos
//   - unparseable sources fail closed
//   - public skills keep their registry checks when the GitHub token is
//     expired, and are skipped with a visible note (or kept via the
//     remembered-public file) when GitHub rate-limits
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

const { _setKeychainForTests, _resetClientAuthCacheForTests } = await import("../../api/client.js");
const { _resetRepoVisibilityForTests } = await import("../repo-visibility.js");
const { _resetBranchCache } = await import("../../discovery/github-tree.js");
const { _resetDefaultGitHubFetchForTests, _resetRejectedTokenWarningForTests } = await import("../github-fetch.js");
const { _resetPrivateSourceForTests, getUnconfirmedRepos } = await import("../private-source.js");
const { getOutdatedJson, outdatedCommand } = await import("../../commands/outdated.js");
const { versionsCommand } = await import("../../commands/versions.js");
const { infoCommand } = await import("../../commands/info.js");
const { submitCommand } = await import("../../commands/submit.js");
const { diffCommand } = await import("../../commands/diff.js");

const PRIVATE_MARKERS = ["secret-skills", "greet", "weird-skill", GITHUB_TOKEN];

interface Call {
  url: string;
  body: string;
  auth: string | undefined;
}
let calls: Call[] = [];
// How GitHub answers GET /repos/acme/open-skills in the current test.
let openRepoMode: "ok" | "rate_limited" | "expired_token" = "ok";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const auth = headers.get("authorization") ?? undefined;
  calls.push({ url, body: typeof init?.body === "string" ? init.body : "", auth });
  if (url === "https://api.github.com/repos/acme/secret-skills") {
    return Promise.resolve(jsonResponse(200, { default_branch: "main", private: true, visibility: "private" }));
  }
  if (url === "https://api.github.com/repos/acme/open-skills") {
    if (openRepoMode === "rate_limited") {
      return Promise.resolve(jsonResponse(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" }));
    }
    if (openRepoMode === "expired_token" && auth) {
      return Promise.resolve(jsonResponse(401, { message: "Bad credentials" }));
    }
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

const entryBase = {
  version: "1.0.0",
  sha: "a".repeat(64),
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
};

function writeLock(): void {
  const lock = {
    version: 1,
    agents: ["claude-code"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skills: {
      // A private plugin: keyed by plugin name, its skills listed in files.
      "acme-tools": {
        ...entryBase,
        source: "github:acme/secret-skills#plugin:acme-tools",
        files: ["greet/SKILL.md", "greet/references/a.md"],
      },
      "open-skill": { ...entryBase, source: "github:acme/open-skills", sourceType: "github" },
      // A source vskill cannot parse: no confirmed-public origin.
      "weird-skill": { ...entryBase, source: "github:acme/somewhere#oddfragment" },
    },
  };
  writeFileSync(join(projectDir.path, "vskill.lock"), JSON.stringify(lock, null, 2));
}

let stderr = "";
const originalFetch = globalThis.fetch;
const originalBase = process.env.VSKILL_API_BASE;
const originalGhToken = process.env.VSKILL_GITHUB_TOKEN;
const originalCache = process.env.VSKILL_VISIBILITY_CACHE;

beforeEach(() => {
  projectDir.path = mkdtempSync(join(tmpdir(), "vskill-egress121-"));
  writeLock();
  calls = [];
  stderr = "";
  openRepoMode = "ok";
  process.env.VSKILL_API_BASE = PLATFORM;
  process.env.VSKILL_GITHUB_TOKEN = GITHUB_TOKEN;
  process.env.VSKILL_VISIBILITY_CACHE = "0";
  globalThis.fetch = vi.fn(fakeFetch) as unknown as typeof fetch;
  _setKeychainForTests({ getGitHubToken: () => GITHUB_TOKEN, getVskillToken: () => null } as never);
  _resetClientAuthCacheForTests();
  _resetRepoVisibilityForTests();
  _resetBranchCache();
  _resetDefaultGitHubFetchForTests();
  _resetRejectedTokenWarningForTests();
  _resetPrivateSourceForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr += args.join(" ") + "\n";
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as never);
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
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("VSKILL_API_BASE", originalBase);
  restore("VSKILL_GITHUB_TOKEN", originalGhToken);
  restore("VSKILL_VISIBILITY_CACHE", originalCache);
});

function checkUpdateNames(): string[] {
  const checks = platformCalls().filter((c) => c.url.endsWith("/api/v1/skills/check-updates"));
  return checks.flatMap((c) => (JSON.parse(c.body).skills as Array<{ name: string }>).map((s) => s.name));
}

describe("skills inside private plugins", () => {
  it("versions, info and diff skip the platform by skill name or owner/repo/skill", async () => {
    await versionsCommand("greet", {});
    await versionsCommand("acme/secret-skills/greet", { json: true });
    await infoCommand("greet");
    await infoCommand("acme/secret-skills/greet");
    await expect(diffCommand("acme/secret-skills/greet", "1.0.0", "2.0.0")).rejects.toThrow("process.exit(1)");

    expect(platformCalls()).toEqual([]);
  });

  it("outdated leaves the private plugin and the unparseable source out", async () => {
    await getOutdatedJson();
    expect(checkUpdateNames()).toEqual(["acme/open-skills/open-skill"]);
    expectNoPrivateDataSent();
  });
});

describe("submit", () => {
  it("never sends a private repo to verified-skill.com", async () => {
    await expect(submitCommand("acme/secret-skills", { skill: "greet" })).rejects.toThrow("process.exit(1)");
    await expect(submitCommand("acme/secret-skills", { skill: "greet", browser: true })).rejects.toThrow(
      "process.exit(1)",
    );
    expect(platformCalls()).toEqual([]);
    expect(stderr).toMatch(/nothing was submitted/);
  });
});

describe("public skills when GitHub cannot confirm visibility", () => {
  it("an expired token is retried anonymously and the public skill is still checked", async () => {
    openRepoMode = "expired_token";
    await getOutdatedJson();

    expect(checkUpdateNames()).toEqual(["acme/open-skills/open-skill"]);
    const repoCalls = calls.filter((c) => c.url === "https://api.github.com/repos/acme/open-skills");
    expect(repoCalls.map((c) => Boolean(c.auth))).toEqual([true, false]);
    expect(stderr).toMatch(/GitHub rejected your token/);
    expectNoPrivateDataSent();
  });

  it("a rate limit skips the public skill and says so", async () => {
    openRepoMode = "rate_limited";
    await outdatedCommand({ json: true }).catch(() => {});

    expect(checkUpdateNames()).not.toContain("acme/open-skills/open-skill");
    expect(getUnconfirmedRepos()).toEqual([{ repo: "acme/open-skills", reason: "rate_limited" }]);
    expect(stderr).toMatch(/rate-limiting/);
    expect(stderr).toMatch(/Skipped registry checks for skills from 1 repo .*acme\/open-skills/);
    expectNoPrivateDataSent();
  });

  it("a rate limit keeps a repo confirmed public recently, from the remembered file", async () => {
    const cacheFile = join(projectDir.path, "repo-visibility.json");
    process.env.VSKILL_VISIBILITY_CACHE = cacheFile;

    // First run: GitHub answers; the public repo is remembered (and only it).
    await getOutdatedJson();
    const remembered = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(Object.keys(remembered.public)).toEqual(["acme/open-skills"]);

    // Next run: rate-limited, but the remembered answer keeps it checked.
    calls = [];
    _resetRepoVisibilityForTests();
    _resetBranchCache();
    _resetPrivateSourceForTests();
    openRepoMode = "rate_limited";
    await getOutdatedJson();

    expect(checkUpdateNames()).toEqual(["acme/open-skills/open-skill"]);
    expect(getUnconfirmedRepos()).toEqual([]);
    expect(stderr).toMatch(/last confirmed public on \d{4}-\d{2}-\d{2}/);
    expectNoPrivateDataSent();
  });

  it("a remembered entry older than 30 days is not used", async () => {
    const cacheFile = join(projectDir.path, "repo-visibility.json");
    process.env.VSKILL_VISIBILITY_CACHE = cacheFile;
    writeFileSync(
      cacheFile,
      JSON.stringify({ public: { "acme/open-skills": { checkedAt: Date.now() - 31 * 24 * 3600 * 1000 } } }),
    );
    openRepoMode = "rate_limited";
    await getOutdatedJson();

    expect(checkUpdateNames()).not.toContain("acme/open-skills/open-skill");
    expect(existsSync(cacheFile)).toBe(true);
  });
});
