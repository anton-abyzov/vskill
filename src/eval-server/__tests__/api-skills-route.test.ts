// ---------------------------------------------------------------------------
// 0733 — /api/skills route MUST filter by the resolved active agent even
// when the caller omits `?agent=`. Without this, the server scans for one
// agent but returns skills from ALL agents (108 vs the 65 the picker shows).
//
// Strategy: capture the GET /api/skills handler via the same fake-router
// pattern used by api-routes-skill-delete.test.ts, seed a fixture root with
// skills owned by claude-code/aider/cursor, and invoke the handler directly.
// We don't spin a real HTTP server — simpler, deterministic, no port races.
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
  return {
    url,
    method: "GET",
    headers: { host: "localhost" },
  };
}

function fakeRes(): { res: unknown; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: undefined };
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    writeHead: (code: number) => {
      captured.statusCode = code;
    },
    end: (data: string) => {
      try {
        captured.body = JSON.parse(data);
      } catch {
        captured.body = data;
      }
    },
  };
  return { res, captured };
}

async function callRoute(
  handler: Handler,
  url: string,
): Promise<CapturedResponse> {
  const { res, captured } = fakeRes();
  await handler(fakeReq(url), res, {});
  return captured;
}

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string): void {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${relDir.split("/").pop()}\ndescription: test\n---\n# skill`);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0733-route-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-0733-home-"));
  // Force HOME so resolveGlobalSkillsDir uses the fixture, not the real home.
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  // Mixed-agent fixture mirroring the bug repro:
  //   - own-scope (project-level skill, sourceAgent should be null)
  //   - claude-code installed (.claude/skills/...)
  //   - aider installed   (.aider/skills/...)
  //   - cursor installed  (.cursor/skills/...)
  writeSkill(tmpRoot, "myplugin/skills/own-skill");
  writeSkill(tmpRoot, ".claude/skills/cc-skill");
  writeSkill(tmpRoot, ".aider/skills/aider-skill");
  writeSkill(tmpRoot, ".cursor/skills/cursor-skill");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("0733 — GET /api/skills filter parity (server defense in depth)", () => {
  it("AC-US2-01: no-?agent= response equals ?agent=<resolved> response", async () => {
    const handler = captureGetHandler("/api/skills", tmpRoot);

    const noParam = await callRoute(handler, "/api/skills");
    const withParam = await callRoute(handler, "/api/skills?agent=claude-code");

    expect(noParam.statusCode).toBe(200);
    expect(withParam.statusCode).toBe(200);
    expect(Array.isArray(noParam.body)).toBe(true);
    expect(Array.isArray(withParam.body)).toBe(true);

    const noParamNames = (noParam.body as Array<{ skill: string }>)
      .map((s) => s.skill).sort();
    const withParamNames = (withParam.body as Array<{ skill: string }>)
      .map((s) => s.skill).sort();

    // The whole point of 0733: these two responses must match.
    expect(noParamNames).toEqual(withParamNames);

    // Specifically: aider/cursor skills must NOT leak into the no-param response
    // when the resolved default is claude-code.
    expect(noParamNames).not.toContain("aider-skill");
    expect(noParamNames).not.toContain("cursor-skill");
    expect(noParamNames).toContain("cc-skill");
    expect(noParamNames).toContain("own-skill");
  });

  it("AC-US2-02: every row in no-param response is own-scope OR sourceAgent === resolved", async () => {
    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills");

    const rows = body as Array<{ scope?: string; sourceAgent?: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const ok = row.scope === "own" || row.sourceAgent === "claude-code";
      expect(ok, `row ${JSON.stringify(row)} violates filter`).toBe(true);
    }
  });

  it("AC-US2-03: ?agent=cursor returns only cursor-owned + own skills (regression guard)", async () => {
    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills?agent=cursor");

    const rows = body as Array<{ skill: string; scope?: string; sourceAgent?: string | null }>;
    const names = rows.map((r) => r.skill).sort();

    expect(names).toContain("own-skill");
    expect(names).toContain("cursor-skill");
    expect(names).not.toContain("aider-skill");
    expect(names).not.toContain("cc-skill");
  });

  it("AC-US2-04: ?scope=garbage returns [] (regression guard)", async () => {
    const handler = captureGetHandler("/api/skills", tmpRoot);
    const { body } = await callRoute(handler, "/api/skills?scope=garbage");
    expect(body).toEqual([]);
  });
});
