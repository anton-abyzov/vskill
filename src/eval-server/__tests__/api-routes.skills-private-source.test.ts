// ---------------------------------------------------------------------------
// /api/skills flags skills installed from a private GitHub repo (or one whose
// visibility GitHub cannot confirm) with `sourcePrivate: true`, so the Studio
// UI keeps them out of every platform request (check-updates, ID lookups).
// Real handler, real vskill.lock on disk; only GitHub's visibility answer is
// stubbed.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const githubVisibility = vi.hoisted(() => new Map<string, "public" | "private">());
vi.mock("../../discovery/github-tree.js", async () => {
  const visibility = await import("../../lib/repo-visibility.js");
  return {
    getDefaultBranch: async (owner: string, repo: string) => {
      const v = githubVisibility.get(`${owner}/${repo}`);
      if (v) visibility.recordRepoVisibility(owner, repo, { visibility: v });
      return "main";
    },
  };
});

const { registerRoutes } = await import("../api-routes.js");
const { _resetRepoVisibilityForTests } = await import("../../lib/repo-visibility.js");

type Handler = (req: unknown, res: unknown, params: Record<string, string>) => Promise<void>;

function captureGetHandler(pathPattern: string, root: string): Handler {
  let captured: Handler | null = null;
  registerRoutes(
    {
      get: (p: string, h: Handler) => {
        if (p === pathPattern) captured = h;
      },
      post: () => {},
      put: () => {},
      delete: () => {},
    } as never,
    root,
  );
  if (!captured) throw new Error(`GET ${pathPattern} handler not registered`);
  return captured;
}

async function getSkills(root: string): Promise<Array<{ skill: string; sourcePrivate?: boolean }>> {
  let body: unknown;
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    writeHead: () => {},
    end: (data: string) => {
      body = JSON.parse(data);
    },
  };
  await captureGetHandler("/api/skills", root)(
    { url: "/api/skills?agent=claude-code", method: "GET", headers: { host: "localhost" } },
    res,
    {},
  );
  return body as Array<{ skill: string; sourcePrivate?: boolean }>;
}

let tmpRoot: string;
let fakeHome: string;
const originalHome = process.env.HOME;

function writeSkill(name: string): void {
  const dir = join(tmpRoot, ".claude/skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n# ${name}\n`);
}

function entry(source: string, extra: Record<string, unknown> = {}) {
  return { version: "1.0.0", source, scope: "project", files: ["SKILL.md"], sha: "x", tier: "VERIFIED", installedAt: "2026-01-01T00:00:00Z", ...extra };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-private-src-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-private-home-"));
  process.env.HOME = fakeHome;
  githubVisibility.clear();
  _resetRepoVisibilityForTests();
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("/api/skills sourcePrivate flag", () => {
  it("flags private and unconfirmed GitHub sources, not public or registry ones", async () => {
    for (const n of ["resume-tuner", "hidden-skill", "flagged", "open-skill", "reg-skill", "unrecorded", "greet", "pdf"]) {
      writeSkill(n);
    }
    githubVisibility.set("acme/secret-skills", "private");
    githubVisibility.set("acme/open-skills", "public");
    writeFileSync(
      join(tmpRoot, "vskill.lock"),
      JSON.stringify({
        skills: {
          "resume-tuner": entry("github:acme/secret-skills"),
          "hidden-skill": entry("github:acme/unknown-visibility"), // GitHub never confirms
          flagged: entry("github:acme/open-skills", { sourcePrivate: true }),
          "open-skill": entry("github:acme/open-skills"),
          "reg-skill": entry("registry:reg-skill"),
          // A private plugin install: keyed by plugin name, skill in files.
          "acme-tools": entry("github:acme/secret-skills#plugin:acme-tools", { files: ["greet/SKILL.md"] }),
        },
        agents: ["claude-code"],
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    const rows = await getSkills(tmpRoot);
    const flag = (name: string) => rows.find((r) => r.skill === name)?.sourcePrivate;

    expect(flag("resume-tuner")).toBe(true);
    expect(flag("hidden-skill")).toBe(true);
    expect(flag("flagged")).toBe(true);
    expect(flag("open-skill")).toBeUndefined();
    expect(flag("reg-skill")).toBeUndefined();
    expect(flag("greet")).toBe(true);
    // An installed skill nobody recorded fails closed; an Anthropic registry
    // name is public upstream.
    expect(flag("unrecorded")).toBe(true);
    expect(flag("pdf")).toBeUndefined();
  });

  it("reads the user-global lockfile for global installs", async () => {
    writeSkill("resume-tuner");
    mkdirSync(join(fakeHome, ".agents"), { recursive: true });
    writeFileSync(
      join(fakeHome, ".agents", "vskill.lock"),
      JSON.stringify({ skills: { "resume-tuner": entry("github:acme/secret-skills", { scope: "user" }) }, agents: [] }),
    );

    const rows = await getSkills(tmpRoot);
    expect(rows.find((r) => r.skill === "resume-tuner")?.sourcePrivate).toBe(true);
  });
});
