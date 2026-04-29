// ---------------------------------------------------------------------------
// 0806 — /api/skills MUST stamp `currentVersion` from `vskill.lock` so the
// client-side resolver can short-circuit to versionSource="registry" on the
// FIRST response. Without this enrichment, the badge starts non-italic
// (versionSource="frontmatter") and only flips to italic later when the
// separately-polled /api/skills/updates lands — the visible flicker.
//
// Same fake-router strategy as api-skills-route.test.ts (0733). We invoke the
// real handler against a temp root that contains a real vskill.lock and real
// SKILL.md files. No HTTP server.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerRoutes } from "../api-routes.js";

type Handler = (
  req: unknown,
  res: unknown,
  params: Record<string, string>,
) => Promise<void>;

function captureGetHandler(pathPattern: string, root: string): Handler {
  let captured: Handler | null = null;
  const fakeRouter = {
    get: (p: string, h: Handler) => {
      if (p === pathPattern) captured = h;
    },
    post: () => {},
    put: () => {},
    delete: () => {},
  };
  registerRoutes(fakeRouter as never, root);
  if (!captured) throw new Error(`GET ${pathPattern} handler not registered`);
  return captured;
}

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function fakeReq(url: string): unknown {
  return { url, method: "GET", headers: { host: "localhost" } };
}

function fakeRes(): { res: unknown; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: undefined };
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    writeHead: (code: number) => { captured.statusCode = code; },
    end: (data: string) => {
      try { captured.body = JSON.parse(data); } catch { captured.body = data; }
    },
  };
  return { res, captured };
}

async function callRoute(handler: Handler, url: string): Promise<CapturedResponse> {
  const { res, captured } = fakeRes();
  await handler(fakeReq(url), res, {});
  return captured;
}

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string, version?: string): void {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  const versionLine = version ? `version: "${version}"\n` : "";
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${relDir.split("/").pop()}\n${versionLine}description: test\n---\n# skill\n`,
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0806-cv-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-0806-home-"));
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("0806 — /api/skills currentVersion enrichment from vskill.lock", () => {
  it("AC-US1-01 / AC-US1-02: lockfile-pinned skill gets currentVersion; lockfile-absent skill stays null", async () => {
    // Three installed skills under .claude/skills/. Two have lockfile entries
    // (foo with explicit version, bar with implicit version — readLockfile()
    // normalizes a missing version to "1.0.0" via migrateLock). baz has no
    // lockfile entry at all.
    writeSkill(tmpRoot, ".claude/skills/foo", "1.2.3");
    writeSkill(tmpRoot, ".claude/skills/bar", "9.9.9"); // disk version differs from lock
    writeSkill(tmpRoot, ".claude/skills/baz", "5.0.0");

    writeFileSync(
      join(tmpRoot, "vskill.lock"),
      JSON.stringify({
        skills: {
          foo: { version: "1.2.3", source: "github:org/foo", scope: "project", files: ["SKILL.md"], sha: "x", tier: "VERIFIED", installedAt: "2026-01-01T00:00:00Z" },
          // Deliberately omit `version` — migrateLock normalizes it to "1.0.0"
          // on read, so the response should reflect "1.0.0" (not null and not
          // the on-disk frontmatter value).
          bar: { source: "github:org/bar", scope: "project", files: ["SKILL.md"], sha: "y", tier: "VERIFIED", installedAt: "2026-01-01T00:00:00Z" },
        },
        agents: ["claude-code"],
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills?agent=claude-code");
    const rows = body as Array<{ skill: string; currentVersion?: string | null }>;

    const fooRow = rows.find((r) => r.skill === "foo");
    const barRow = rows.find((r) => r.skill === "bar");
    const bazRow = rows.find((r) => r.skill === "baz");

    expect(fooRow, "foo must be in response").toBeDefined();
    expect(barRow, "bar must be in response").toBeDefined();
    expect(bazRow, "baz must be in response").toBeDefined();

    // AC-US1-01: lockfile-pinned version wins (server-stamped, not from disk)
    expect(fooRow!.currentVersion).toBe("1.2.3");

    // AC-US1-01: lockfile entry without explicit version is normalized by
    // migrateLock to "1.0.0" — server still surfaces a non-null currentVersion
    // because the entry IS pinned, just at the default.
    expect(barRow!.currentVersion).toBe("1.0.0");

    // AC-US1-02 / AC-US2-01: no lockfile entry → currentVersion stays null,
    // resolver falls through to frontmatter, badge stays non-italic.
    expect(bazRow!.currentVersion).toBeNull();
  });

  it("AC-US1-02 (no vskill.lock at all): every row has currentVersion === null", async () => {
    writeSkill(tmpRoot, ".claude/skills/alpha", "0.1.0");
    writeSkill(tmpRoot, ".claude/skills/beta", "0.2.0");
    // Deliberately NO vskill.lock written.

    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills?agent=claude-code");
    const rows = body as Array<{ skill: string; currentVersion?: string | null }>;

    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.currentVersion, `row ${r.skill} must have currentVersion === null when no lockfile`).toBeNull();
    }
  });

  it("AC-US2-02 (response shape additive): currentVersion field is present on every row, type string|null", async () => {
    writeSkill(tmpRoot, ".claude/skills/x", "1.0.0");

    writeFileSync(
      join(tmpRoot, "vskill.lock"),
      JSON.stringify({
        skills: {
          x: { version: "1.0.0", source: "github:org/x", scope: "project", files: ["SKILL.md"], sha: "z", tier: "VERIFIED", installedAt: "2026-01-01T00:00:00Z" },
        },
        agents: ["claude-code"],
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    );

    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills?agent=claude-code");
    const rows = body as Array<{ skill: string; currentVersion?: string | null }>;

    for (const r of rows) {
      expect("currentVersion" in r, `row ${r.skill} must have currentVersion field`).toBe(true);
      const cv = r.currentVersion;
      expect(cv === null || typeof cv === "string", `currentVersion must be string|null, got ${typeof cv}`).toBe(true);
    }
  });
});
