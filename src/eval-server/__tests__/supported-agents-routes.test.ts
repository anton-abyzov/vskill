// 0845 T-005 — GET /api/studio/supported-agents route.
//
// Returns the full SupportedAgent[] from agents-registry.getSupportedAgents()
// so the Studio's InstallTargetsModal can render every installable tool —
// detected or not. Localhost-only (FR-007).
//
// ACs covered: AC-US1-01, AC-US1-02, AC-US6-02.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  getSupportedAgents: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson };
});
vi.mock("../../agents/agents-registry.js", () => ({
  getSupportedAgents: mocks.getSupportedAgents,
}));

const { registerSupportedAgentsRoutes } = await import(
  "../supported-agents-routes.js"
);

function captureHandler() {
  let handler: any;
  const fakeRouter: any = {
    get: vi.fn((_path: string, h: any) => {
      handler = h;
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerSupportedAgentsRoutes(fakeRouter);
  return { handler, fakeRouter };
}

function fakeReq(opts: { remoteAddress?: string } = {}) {
  return {
    url: "/api/studio/supported-agents",
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

const filesystemAgent = {
  id: "codex",
  displayName: "Codex CLI",
  detected: false,
  tier: 1 as const,
  installMode: "filesystem" as const,
  resolvedGlobalDir: "/home/u/.codex/skills",
  resolvedLocalDir: ".codex/skills",
};

const clipboardAgent = {
  id: "chatgpt",
  displayName: "ChatGPT",
  detected: false,
  tier: 3 as const,
  installMode: "clipboard" as const,
  resolvedGlobalDir: "/home/u/.chatgpt/skills",
  resolvedLocalDir: ".chatgpt/skills",
  pasteInstructionsUrl: "https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions",
  docsUrl: "https://chatgpt.com/#settings/Personalization",
};

describe("0845 T-005 — GET /api/studio/supported-agents", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = captureHandler().handler;
    mocks.getSupportedAgents.mockResolvedValue([filesystemAgent, clipboardAgent]);
  });

  it("AC-US1-01: route is registered", () => {
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("AC-US1-01: returns { agents: SupportedAgent[] } with status 200", async () => {
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});

    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(200);
    const body = sent[1];
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents).toHaveLength(2);
  });

  it("AC-US1-01: each agent exposes id/displayName/detected/tier/installMode/resolvedGlobalDir/resolvedLocalDir", async () => {
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});
    const body = mocks.sendJson.mock.calls[0][1];
    for (const a of body.agents) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.displayName).toBe("string");
      expect(typeof a.detected).toBe("boolean");
      expect([1, 2, 3]).toContain(a.tier);
      expect(["filesystem", "clipboard"]).toContain(a.installMode);
      expect(typeof a.resolvedGlobalDir).toBe("string");
      expect(typeof a.resolvedLocalDir).toBe("string");
    }
  });

  it("AC-US1-01: clipboard agents include pasteInstructionsUrl in the response", async () => {
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});
    const body = mocks.sendJson.mock.calls[0][1];
    const cg = body.agents.find((a: any) => a.id === "chatgpt");
    expect(cg).toBeDefined();
    expect(cg.pasteInstructionsUrl).toMatch(/^https:\/\//);
  });

  it("FR-007: rejects non-loopback remoteAddress with 403", async () => {
    const req = fakeReq({ remoteAddress: "192.168.1.42" });
    const res = fakeRes();
    await handler(req, res, {});
    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(403);
    expect(sent[1].error).toMatch(/localhost-only/i);
  });

  it("FR-007: accepts IPv6 loopback ::1", async () => {
    const req = fakeReq({ remoteAddress: "::1" });
    const res = fakeRes();
    await handler(req, res, {});
    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(200);
  });

  it("FR-007: accepts IPv4-mapped IPv6 loopback ::ffff:127.0.0.1", async () => {
    const req = fakeReq({ remoteAddress: "::ffff:127.0.0.1" });
    const res = fakeRes();
    await handler(req, res, {});
    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(200);
  });

  it("AC-US1-02: handler delegates to getSupportedAgents (NOT detectInstalledAgents)", async () => {
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});
    expect(mocks.getSupportedAgents).toHaveBeenCalledOnce();
  });

  it("AC-US6-02: handler returns gracefully when getSupportedAgents rejects", async () => {
    mocks.getSupportedAgents.mockRejectedValueOnce(new Error("probe blew up"));
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, {});
    const sent = mocks.sendJson.mock.calls[0];
    expect(sent[2]).toBe(500);
    expect(sent[1].error).toBeDefined();
  });

  it("route path is /api/studio/supported-agents", () => {
    const { fakeRouter } = captureHandler();
    expect(fakeRouter.get).toHaveBeenCalledWith(
      "/api/studio/supported-agents",
      expect.any(Function),
    );
  });
});
