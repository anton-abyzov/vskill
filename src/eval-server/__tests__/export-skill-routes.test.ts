// 0845 T-015 — POST /api/studio/export-skill route.
//
// Returns { skill, agentId, blob, pasteInstructionsUrl, docsUrl } for a
// Tier-3 agent. Localhost-only, SAFE_NAME validated. 400 for Tier 1/2,
// 403 for non-loopback, 404 for unknown agent.
//
// ACs covered: AC-US5-03, AC-US5-07, FR-007.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  buildClipboardBlob: vi.fn(),
  getAgent: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson, readBody: mocks.readBody };
});
vi.mock("../../installer/clipboard-export.js", () => ({
  buildClipboardBlob: mocks.buildClipboardBlob,
}));
vi.mock("../../agents/agents-registry.js", () => ({
  getAgent: mocks.getAgent,
}));

const { registerExportSkillRoutes } = await import("../export-skill-routes.js");

function captureHandler() {
  let handler: any;
  const fakeRouter: any = {
    get: vi.fn(),
    post: vi.fn((_path: string, h: any) => { handler = h; }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerExportSkillRoutes(fakeRouter);
  return { handler, fakeRouter };
}

function fakeReq(opts: { remoteAddress?: string } = {}) {
  return {
    url: "/api/studio/export-skill",
    method: "POST",
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

describe("0845 T-015 — POST /api/studio/export-skill", () => {
  let handler: any;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = captureHandler().handler;
  });

  it("route is registered as POST", () => {
    const { fakeRouter } = captureHandler();
    expect(fakeRouter.post).toHaveBeenCalledWith(
      "/api/studio/export-skill",
      expect.any(Function),
    );
  });

  it("AC-US5-03: happy path returns blob + URLs for a Tier 3 agent", async () => {
    mocks.readBody.mockResolvedValueOnce({
      skill: { name: "obsidian-brain", description: "PARA", body: "X", originalFrontmatter: "" },
      agentId: "chatgpt",
    });
    mocks.getAgent.mockReturnValueOnce({ id: "chatgpt", installMode: "clipboard" });
    mocks.buildClipboardBlob.mockReturnValueOnce({
      blob: "# obsidian-brain\n\nPARA\n",
      pasteInstructionsUrl: "https://help.openai.com/paste",
      docsUrl: "https://chatgpt.com/",
    });

    const res = fakeRes();
    await handler(fakeReq(), res, {});

    const [, body, status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(200);
    expect(body.agentId).toBe("chatgpt");
    expect(body.blob).toContain("obsidian-brain");
    expect(body.pasteInstructionsUrl).toMatch(/^https:/);
    expect(body.docsUrl).toMatch(/^https:/);
  });

  it("returns 400 when agentId is a Tier 1 agent (codex)", async () => {
    mocks.readBody.mockResolvedValueOnce({
      skill: { name: "x", description: "d", body: "b", originalFrontmatter: "" },
      agentId: "codex",
    });
    mocks.getAgent.mockReturnValueOnce({ id: "codex", installMode: "filesystem" });
    const res = fakeRes();
    await handler(fakeReq(), res, {});
    const [, body, status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(400);
    expect(body.error).toMatch(/tier|clipboard/i);
  });

  it("returns 404 when agentId is unknown", async () => {
    mocks.readBody.mockResolvedValueOnce({
      skill: { name: "x", description: "d", body: "b", originalFrontmatter: "" },
      agentId: "no-such-agent",
    });
    mocks.getAgent.mockReturnValueOnce(undefined);
    const res = fakeRes();
    await handler(fakeReq(), res, {});
    const [, , status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(404);
  });

  it("returns 400 when agentId fails SAFE_NAME (path traversal attempt)", async () => {
    mocks.readBody.mockResolvedValueOnce({
      skill: { name: "x", description: "d", body: "b", originalFrontmatter: "" },
      agentId: "../etc/passwd",
    });
    const res = fakeRes();
    await handler(fakeReq(), res, {});
    const [, body, status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid/i);
  });

  it("returns 400 when skill is missing or malformed", async () => {
    mocks.readBody.mockResolvedValueOnce({ agentId: "chatgpt" });
    const res = fakeRes();
    await handler(fakeReq(), res, {});
    const [, , status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(400);
  });

  it("FR-007: rejects non-loopback with 403", async () => {
    const res = fakeRes();
    await handler(fakeReq({ remoteAddress: "192.168.1.42" }), res, {});
    const [, body, status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(403);
    expect(body.error).toMatch(/localhost-only/i);
    expect(mocks.readBody).not.toHaveBeenCalled();
  });

  it("returns 500 when buildClipboardBlob throws unexpectedly", async () => {
    mocks.readBody.mockResolvedValueOnce({
      skill: { name: "x", description: "d", body: "b", originalFrontmatter: "" },
      agentId: "chatgpt",
    });
    mocks.getAgent.mockReturnValueOnce({ id: "chatgpt", installMode: "clipboard" });
    mocks.buildClipboardBlob.mockImplementationOnce(() => {
      throw new Error("oops");
    });
    const res = fakeRes();
    await handler(fakeReq(), res, {});
    const [, , status] = mocks.sendJson.mock.calls[0];
    expect(status).toBe(500);
  });
});
