// 0827 T-001/T-003 — GET /api/studio/install-state?skill=<publisher>/<slug>
//
// Reports per-scope install state (project, user) for a single skill, plus the
// list of agent tools detected on the host. Reuses readLockfile (project root +
// ~/.agents/) as the SSoT and detectInstalledAgents() for the destination list.
// Localhost-only.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readLockfile: vi.fn(),
  detectInstalledAgents: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson };
});
vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: mocks.readLockfile,
}));
vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: mocks.detectInstalledAgents,
}));

const { registerInstallStateRoutes } = await import("../install-state-routes.js");

function captureHandler() {
  let handler: any;
  const fakeRouter: any = {
    get: vi.fn((_path: string, h: any) => { handler = h; }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerInstallStateRoutes(fakeRouter, "/test-root");
  return handler;
}

function fakeReq(opts: { url?: string; remoteAddress?: string } = {}) {
  return {
    url: opts.url ?? "/api/studio/install-state?skill=gitroomhq/postiz-agent/postiz",
    method: "GET",
    headers: {},
    socket: { remoteAddress: opts.remoteAddress ?? "127.0.0.1" },
  } as any;
}

function fakeRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    headersSent: false,
  } as any;
}

const claudeCodeAgent = {
  id: "claude-code",
  displayName: "Claude Code",
  localSkillsDir: ".claude/skills",
  globalSkillsDir: "~/.claude/skills",
};
const cursorAgent = {
  id: "cursor",
  displayName: "Cursor",
  localSkillsDir: ".cursor/skills",
  globalSkillsDir: "~/.cursor/skills",
};

describe("0827 — GET /api/studio/install-state", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = captureHandler();
    mocks.detectInstalledAgents.mockResolvedValue([claudeCodeAgent]);
    mocks.readLockfile.mockReturnValue(null);
  });

  it("AC-US2-01: route is registered", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("AC-US2-05: rejects non-loopback remoteAddress with 403", async () => {
    const req = fakeReq({ remoteAddress: "192.168.1.42" });
    const res = fakeRes();
    await handler(req, res, {});

    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(403);
    expect(sent[1].error).toMatch(/localhost-only/i);
  });

  it("AC-US2-01: returns 400 for missing skill query param", async () => {
    const req = fakeReq({ url: "/api/studio/install-state" });
    const res = fakeRes();
    await handler(req, res, {});

    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(400);
    expect(sent[1].error).toMatch(/invalid skill identifier/i);
  });

  it("AC-US2-01: returns 400 for malformed skill identifier", async () => {
    const req = fakeReq({ url: "/api/studio/install-state?skill=--malicious" });
    const res = fakeRes();
    await handler(req, res, {});

    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(400);
  });

  it("AC-US2-04: returns 200 with installed=false for both scopes when never installed", async () => {
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(200);
    const body = sent[1];
    expect(body.skill).toBe("gitroomhq/postiz-agent/postiz");
    expect(body.scopes.project.installed).toBe(false);
    expect(body.scopes.user.installed).toBe(false);
    expect(body.scopes.project.installedAgentTools).toEqual([]);
    expect(body.scopes.user.installedAgentTools).toEqual([]);
    expect(body.scopes.project.version).toBeNull();
    expect(body.scopes.user.version).toBeNull();
  });

  it("AC-US2-04: detectedAgentTools mirrors detectInstalledAgents output shape", async () => {
    mocks.detectInstalledAgents.mockResolvedValue([claudeCodeAgent, cursorAgent]);
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const body = mocks.sendJson.mock.calls[0][1];
    expect(body.detectedAgentTools).toEqual([
      {
        id: "claude-code",
        displayName: "Claude Code",
        localDir: ".claude/skills",
        globalDir: "~/.claude/skills",
      },
      {
        id: "cursor",
        displayName: "Cursor",
        localDir: ".cursor/skills",
        globalDir: "~/.cursor/skills",
      },
    ]);
  });

  it("AC-US2-02: scopes.user.installed=true when ~/.agents/vskill.lock has the skill", async () => {
    // Project lockfile empty. User lockfile has postiz.
    mocks.readLockfile.mockImplementation((dir?: string) => {
      if (dir && dir.includes(".agents")) {
        return {
          version: 1,
          agents: ["claude-code"],
          skills: {
            postiz: {
              version: "2.0.12",
              sha: "",
              tier: "VERIFIED",
              installedAt: "2026-05-04T22:13:00.000Z",
              source: "marketplace:gitroomhq/postiz-agent#postiz",
              marketplace: "postiz-agent",
              pluginDir: true,
              scope: "user",
            },
          },
          createdAt: "",
          updatedAt: "",
        };
      }
      return null;
    });

    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const body = mocks.sendJson.mock.calls[0][1];
    expect(body.scopes.user.installed).toBe(true);
    expect(body.scopes.user.version).toBe("2.0.12");
    expect(body.scopes.user.installedAgentTools).toEqual(["claude-code"]);
    expect(body.scopes.project.installed).toBe(false);
  });

  it("AC-US2-03: scopes.project.installed=true when project root vskill.lock has the skill", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) => {
      if (dir && dir.includes(".agents")) return null;
      // Project root call
      return {
        version: 1,
        agents: ["claude-code", "cursor"],
        skills: {
          postiz: {
            version: "2.0.12",
            sha: "",
            tier: "VERIFIED",
            installedAt: "",
            source: "marketplace:gitroomhq/postiz-agent#postiz",
            marketplace: "postiz-agent",
            pluginDir: true,
            scope: "project",
          },
        },
        createdAt: "",
        updatedAt: "",
      };
    });

    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const body = mocks.sendJson.mock.calls[0][1];
    expect(body.scopes.project.installed).toBe(true);
    expect(body.scopes.project.version).toBe("2.0.12");
    expect(body.scopes.project.installedAgentTools).toEqual(["claude-code", "cursor"]);
    expect(body.scopes.user.installed).toBe(false);
  });

  it("AC-US2-02 + AC-US2-03: same skill installed at BOTH scopes reports both as installed", async () => {
    const skillEntry = {
      version: "2.0.12",
      sha: "",
      tier: "VERIFIED",
      installedAt: "",
      source: "marketplace:gitroomhq/postiz-agent#postiz",
      marketplace: "postiz-agent",
      pluginDir: true,
    };
    mocks.readLockfile.mockImplementation((dir?: string) => ({
      version: 1,
      agents: dir && dir.includes(".agents") ? ["claude-code"] : ["claude-code", "cursor"],
      skills: { postiz: { ...skillEntry, scope: dir && dir.includes(".agents") ? "user" : "project" } },
      createdAt: "",
      updatedAt: "",
    }));

    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const body = mocks.sendJson.mock.calls[0][1];
    expect(body.scopes.user.installed).toBe(true);
    expect(body.scopes.user.installedAgentTools).toEqual(["claude-code"]);
    expect(body.scopes.project.installed).toBe(true);
    expect(body.scopes.project.installedAgentTools).toEqual(["claude-code", "cursor"]);
  });

  it("returns version=null when the lockfile entry version is the placeholder '0.0.0'", async () => {
    mocks.readLockfile.mockImplementation((dir?: string) => {
      if (dir && dir.includes(".agents")) {
        return {
          version: 1,
          agents: ["claude-code"],
          skills: {
            postiz: {
              version: "0.0.0",
              sha: "",
              tier: "VERIFIED",
              installedAt: "",
              source: "marketplace:gitroomhq/postiz-agent#postiz",
            },
          },
          createdAt: "",
          updatedAt: "",
        };
      }
      return null;
    });

    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const body = mocks.sendJson.mock.calls[0][1];
    expect(body.scopes.user.installed).toBe(true);
    expect(body.scopes.user.version).toBeNull();
  });
});
