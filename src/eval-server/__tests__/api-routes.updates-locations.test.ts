// ---------------------------------------------------------------------------
// 0747 T-002: /api/skills/updates MUST attach installLocations[], localPlugin,
// localSkill per row. The scan MUST run once per request (per-request
// memoization) so 100 outdated rows don't trigger 100 scans of all agents.
//
// Strategy: import the route handler via the same captured-router pattern used
// by api-skills-route.test.ts, mock getOutdatedJson via vi.hoisted + vi.mock,
// mock scanSkillInstallLocations to count calls, invoke the route, assert
// shape + call counts.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => {
  return {
    getOutdatedJson: vi.fn(),
    scanSkillInstallLocations: vi.fn(),
  };
});

vi.mock("../../commands/outdated.js", () => ({
  getOutdatedJson: mocks.getOutdatedJson,
}));

vi.mock("../utils/scan-install-locations.js", () => ({
  scanSkillInstallLocations: mocks.scanSkillInstallLocations,
}));

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

function fakeReq(url: string): unknown {
  return { url, method: "GET", headers: { host: "localhost" } };
}

function fakeRes(): { res: unknown; captured: { statusCode: number; body: unknown } } {
  const captured = { statusCode: 200, body: undefined as unknown };
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

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-updates-loc-"));
  mocks.getOutdatedJson.mockReset();
  mocks.scanSkillInstallLocations.mockReset();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/skills/updates with location enrichment", () => {
  it("TC-001: attaches installLocations[] per row using the scan utility", async () => {
    mocks.getOutdatedJson.mockResolvedValue({
      results: [
        { name: "owner/repo/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "owner/repo/bar", installed: "2.0.0", latest: "2.0.1", updateAvailable: true },
      ],
      pinMap: new Map(),
    });
    mocks.scanSkillInstallLocations.mockImplementation((name: string) => {
      if (name === "owner/repo/foo") {
        return [
          {
            scope: "personal",
            agent: "claude-code",
            agentLabel: "Claude Code",
            dir: "/h/.claude/skills/foo",
            symlinked: false,
            readonly: false,
          },
        ];
      }
      return [];
    });

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res, captured } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    expect(captured.statusCode).toBe(200);
    const body = captured.body as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);

    const foo = body.find((r) => r.name === "owner/repo/foo");
    expect(foo?.installLocations).toBeDefined();
    expect((foo?.installLocations as unknown[]).length).toBe(1);
    expect(foo?.localSkill).toBe("foo");

    const bar = body.find((r) => r.name === "owner/repo/bar");
    expect(bar?.installLocations).toEqual([]);
  });

  it("TC-002: scan runs once per unique canonical name (3 distinct names → 3 calls)", async () => {
    mocks.getOutdatedJson.mockResolvedValue({
      results: [
        { name: "owner/repo/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "owner/repo/bar", installed: "2.0.0", latest: "2.0.1", updateAvailable: true },
        { name: "owner/repo/baz", installed: "3.0.0", latest: "3.0.1", updateAvailable: true },
      ],
      pinMap: new Map(),
    });
    mocks.scanSkillInstallLocations.mockReturnValue([]);

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    // AC-US4-06: per-request, name-keyed memoization. Three unique names
    // → three scan calls (no redundancy across rows).
    expect(mocks.scanSkillInstallLocations.mock.calls.length).toBe(3);
  });

  it("TC-002b (F-004 regression): duplicate canonical names share a single scan call", async () => {
    // Defensive memoization: if /api/skills/updates ever returns two rows
    // with the same canonical name (e.g. cross-source collision), the
    // scanner must NOT be invoked twice for the same name. Caps cost at
    // O(unique names) instead of O(rows).
    mocks.getOutdatedJson.mockResolvedValue({
      results: [
        { name: "owner/repo/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "owner/repo/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "owner/repo/bar", installed: "2.0.0", latest: "2.0.1", updateAvailable: true },
      ],
      pinMap: new Map(),
    });
    mocks.scanSkillInstallLocations.mockReturnValue([]);

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    // 3 rows but only 2 unique names → 2 scan calls.
    expect(mocks.scanSkillInstallLocations.mock.calls.length).toBe(2);
  });

  it("TC-003: backwards-compat — preserves existing fields exactly", async () => {
    mocks.getOutdatedJson.mockResolvedValue({
      results: [
        {
          name: "owner/repo/foo",
          installed: "1.0.0",
          latest: "1.1.0",
          updateAvailable: true,
          trackedForUpdates: true,
        },
      ],
      pinMap: new Map([["owner/repo/foo", "1.0.0"]]),
    });
    mocks.scanSkillInstallLocations.mockReturnValue([]);

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res, captured } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    const body = captured.body as Array<Record<string, unknown>>;
    const foo = body[0];
    // Existing fields untouched
    expect(foo.name).toBe("owner/repo/foo");
    expect(foo.installed).toBe("1.0.0");
    expect(foo.latest).toBe("1.1.0");
    expect(foo.updateAvailable).toBe(true);
    expect(foo.trackedForUpdates).toBe(true);
    expect(foo.pinned).toBe(true);
    expect(foo.pinnedVersion).toBe("1.0.0");
    // New optional fields present
    expect("installLocations" in foo).toBe(true);
    expect("localSkill" in foo).toBe(true);
  });

  it("TC-004: localPlugin/localSkill resolve from highest-precedence install", async () => {
    mocks.getOutdatedJson.mockResolvedValue({
      results: [
        { name: "owner/repo/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
      ],
      pinMap: new Map(),
    });
    mocks.scanSkillInstallLocations.mockReturnValue([
      // personal first, project second — implementation must prefer project
      {
        scope: "personal",
        agent: "claude-code",
        agentLabel: "Claude Code",
        dir: "/h/.claude/skills/foo",
        symlinked: false,
        readonly: false,
      },
      {
        scope: "project",
        agent: "claude-code",
        agentLabel: "Claude Code",
        dir: `${root}/.claude/skills/foo`,
        symlinked: false,
        readonly: false,
      },
    ]);

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res, captured } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    const body = captured.body as Array<Record<string, unknown>>;
    expect(body[0].localSkill).toBe("foo");
  });

  it("TC-005: returns [] when getOutdatedJson returns null (no lockfile)", async () => {
    mocks.getOutdatedJson.mockResolvedValue(null);

    const handler = captureGetHandler("/api/skills/updates", root);
    const { res, captured } = fakeRes();
    await handler(fakeReq("http://localhost/api/skills/updates"), res, {});

    expect(captured.body).toEqual([]);
    // Scanner not called when there are no outdated rows
    expect(mocks.scanSkillInstallLocations.mock.calls.length).toBe(0);
  });
});
