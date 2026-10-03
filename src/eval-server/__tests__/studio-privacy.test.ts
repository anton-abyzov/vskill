// ---------------------------------------------------------------------------
// studio-privacy: which Studio-listed skills may be sent to verified-skill.com.
// Covers skills inside private plugin installs (lock keyed by plugin name),
// Claude plugin-cache skills (marketplace clone origin), skills the user
// authors (checkout origin) and installed skills nobody recorded.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VskillLock } from "../../lockfile/types.js";

const { _resetRepoVisibilityForTests } = await import("../../lib/repo-visibility.js");
const { _resetBranchCache } = await import("../../discovery/github-tree.js");
const { _resetPrivateSourceForTests } = await import("../../lib/private-source.js");
const { findLockEntryForStudioSkill, isPrivateStudioSkill, _resetStudioPrivacyForTests } = await import(
  "../studio-privacy.js"
);

const entry = (source: string, extra: Record<string, unknown> = {}) => ({
  version: "1.0.0",
  sha: "a".repeat(64),
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source,
  ...extra,
});

function lockOf(skills: Record<string, unknown>): VskillLock {
  return {
    version: 1,
    agents: [],
    skills: skills as VskillLock["skills"],
    createdAt: "",
    updatedAt: "",
  };
}

function gitCheckout(remote: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-privacy-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

const dirs: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetRepoVisibilityForTests();
  _resetBranchCache();
  _resetPrivateSourceForTests();
  _resetStudioPrivacyForTests();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/open-skills") {
      return new Response(JSON.stringify({ default_branch: "main", private: false }), { status: 200 });
    }
    if (url === "https://api.github.com/repos/acme/secret-skills") {
      return new Response(JSON.stringify({ default_branch: "main", private: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("findLockEntryForStudioSkill", () => {
  const locks = [
    lockOf({
      "acme-tools": entry("github:acme/secret-skills#plugin:acme-tools", { files: ["greet/SKILL.md"] }),
      "mkt-plugin": entry("marketplace:acme/secret-skills#mkt-plugin", { marketplace: "acme-mkt" }),
      solo: entry("github:acme/open-skills"),
    }),
  ];

  it("matches by skill name, plugin name, or recorded files", () => {
    expect(findLockEntryForStudioSkill(locks, { skill: "solo", plugin: ".claude" })?.source).toBe(
      "github:acme/open-skills",
    );
    expect(
      findLockEntryForStudioSkill(locks, { skill: "deploy", plugin: "mkt-plugin", pluginMarketplace: "acme-mkt" })
        ?.source,
    ).toBe("marketplace:acme/secret-skills#mkt-plugin");
    expect(findLockEntryForStudioSkill(locks, { skill: "greet", plugin: ".claude" })?.source).toBe(
      "github:acme/secret-skills#plugin:acme-tools",
    );
  });

  it("does not take an agent dir like .claude as a plugin key", () => {
    const l = [lockOf({ ".claude": entry("github:acme/open-skills") })];
    expect(findLockEntryForStudioSkill(l, { skill: "x", plugin: ".claude" })).toBeNull();
  });
});

describe("isPrivateStudioSkill", () => {
  const locks = [
    lockOf({
      "acme-tools": entry("github:acme/secret-skills#plugin:acme-tools", { files: ["greet/SKILL.md"] }),
      solo: entry("github:acme/open-skills"),
    }),
  ];

  it("flags a skill inside a private plugin install", async () => {
    expect(await isPrivateStudioSkill({ skill: "greet", plugin: ".claude", origin: "installed" }, locks)).toBe(true);
    expect(await isPrivateStudioSkill({ skill: "solo", plugin: ".claude", origin: "installed" }, locks)).toBe(false);
  });

  it("judges an authored skill by its own checkout's GitHub origin", async () => {
    const pub = gitCheckout("https://github.com/acme/open-skills.git");
    const priv = gitCheckout("git@github.com:acme/secret-skills.git");
    const none = gitCheckout(null);
    dirs.push(pub, priv, none);
    mkdirSync(join(pub, "skills", "solo"), { recursive: true });

    // A same-named public lock entry does not make a private authored skill public.
    expect(await isPrivateStudioSkill({ skill: "solo", dir: priv, origin: "source" }, locks)).toBe(true);
    expect(await isPrivateStudioSkill({ skill: "x", dir: none, origin: "source" }, locks)).toBe(true);
    expect(
      await isPrivateStudioSkill({ skill: "solo", dir: join(pub, "skills", "solo"), origin: "source" }, locks),
    ).toBe(false);
  });

  it("fails closed for an installed skill nobody recorded, except Anthropic registry names", async () => {
    expect(await isPrivateStudioSkill({ skill: "mystery", plugin: ".claude", origin: "installed" }, [])).toBe(true);
    expect(await isPrivateStudioSkill({ skill: "pdf", plugin: ".claude", origin: "installed" }, [])).toBe(false);
  });

  it("flags a plugin-cache skill whose marketplace has no confirmed-public clone", async () => {
    expect(
      await isPrivateStudioSkill(
        { skill: "deploy", plugin: "p", pluginName: "p", pluginMarketplace: "no-such-marketplace-xyz", origin: "installed" },
        [],
      ),
    ).toBe(true);
  });
});
