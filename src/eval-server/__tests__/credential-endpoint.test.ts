// ---------------------------------------------------------------------------
// Unit tests for PUT /api/credentials/:plugin/:skill and
// GET /api/credentials/:plugin/:skill/params
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  resolveSkillDir: vi.fn(),
  writeCredential: vi.fn(),
  resolveCredential: vi.fn(),
  resolveAllCredentials: vi.fn(),
  parseDotenv: vi.fn(),
  loadAndValidateEvals: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendJson: mocks.sendJson,
    readBody: mocks.readBody,
  };
});

vi.mock("../skill-resolver.js", () => ({
  resolveSkillDir: mocks.resolveSkillDir,
}));

vi.mock("../../eval/credential-resolver.js", () => ({
  writeCredential: mocks.writeCredential,
  resolveCredential: mocks.resolveCredential,
  resolveAllCredentials: mocks.resolveAllCredentials,
  parseDotenv: mocks.parseDotenv,
}));

vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: mocks.loadAndValidateEvals,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: mocks.existsSync,
    readFileSync: mocks.readFileSync,
  };
});

// Stub SSE + integration-runner (not needed for credential routes)
vi.mock("../sse-helpers.js", () => ({
  initSSE: vi.fn(),
  sendSSE: vi.fn(),
  sendSSEDone: vi.fn(),
}));

vi.mock("../../eval/integration-runner.js", () => ({
  runIntegrationCase: vi.fn(),
  isFirstRun: vi.fn(),
  recordRun: vi.fn(),
  promptConfirmation: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import and capture handlers
// ---------------------------------------------------------------------------

const { registerIntegrationRoutes } = await import("../integration-routes.js");

function captureHandlers() {
  const handlers: Record<string, Record<string, any>> = { get: {}, put: {}, post: {} };
  const fakeRouter = {
    get: vi.fn((path: string, handler: any) => { handlers.get[path] = handler; }),
    put: vi.fn((path: string, handler: any) => { handlers.put[path] = handler; }),
    post: vi.fn((path: string, handler: any) => { handlers.post[path] = handler; }),
    delete: vi.fn(),
  };
  registerIntegrationRoutes(fakeRouter as any, "/root");
  return handlers;
}

// ---------------------------------------------------------------------------
// Tests: PUT /api/credentials/:plugin/:skill
// ---------------------------------------------------------------------------

describe("PUT /api/credentials/:plugin/:skill", () => {
  let handler: any;
  const fakeReq = {} as any;
  const fakeRes = {} as any;
  const params = { plugin: "myplugin", skill: "myskill" };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockReturnValue("/root/myplugin/myskill");
    const handlers = captureHandlers();
    handler = handlers.put["/api/credentials/:plugin/:skill"];
  });

  it("saves a valid credential and returns ok with status", async () => {
    mocks.readBody.mockResolvedValue({ name: "SLACK_BOT_TOKEN", value: "xoxb-123" });
    mocks.resolveCredential.mockReturnValue({ value: "xoxb-123", source: "dotenv" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeCredential).toHaveBeenCalledWith(
      "/root/myplugin/myskill",
      "SLACK_BOT_TOKEN",
      "xoxb-123",
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { ok: true, credential: { name: "SLACK_BOT_TOKEN", status: "ready", source: "dotenv" } },
      200,
      fakeReq,
    );
  });

  it("rejects empty name with 400", async () => {
    mocks.readBody.mockResolvedValue({ name: "", value: "some-value" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeCredential).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "name is required and must be a non-empty string" },
      400,
      fakeReq,
    );
  });

  it("rejects missing value with 400", async () => {
    mocks.readBody.mockResolvedValue({ name: "KEY" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeCredential).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "value is required and must be a string" },
      400,
      fakeReq,
    );
  });

  it("rejects whitespace-only value with 400", async () => {
    mocks.readBody.mockResolvedValue({ name: "KEY", value: "   " });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeCredential).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "value must not be empty or whitespace-only" },
      400,
      fakeReq,
    );
  });

  it("handles write errors with 500", async () => {
    mocks.readBody.mockResolvedValue({ name: "KEY", value: "val" });
    mocks.writeCredential.mockImplementation(() => { throw new Error("EACCES: permission denied"); });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "EACCES: permission denied" },
      500,
      fakeReq,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/credentials/:plugin/:skill/params
// ---------------------------------------------------------------------------

describe("GET /api/credentials/:plugin/:skill/params", () => {
  let handler: any;
  const fakeReq = {} as any;
  const fakeRes = {} as any;
  const params = { plugin: "myplugin", skill: "myskill" };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockReturnValue("/root/myplugin/myskill");
    const handlers = captureHandlers();
    handler = handlers.get["/api/credentials/:plugin/:skill/params"];
  });

  it("returns empty array when .env.local does not exist", async () => {
    mocks.existsSync.mockReturnValue(false);

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { params: [] },
      200,
      fakeReq,
    );
  });

  it("returns masked params when .env.local exists", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("KEY1=secret123\nKEY2=abc");
    mocks.parseDotenv.mockReturnValue({ KEY1: "secret123", KEY2: "abc" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      {
        params: [
          { name: "KEY1", maskedValue: "***t123", status: "ready" },
          { name: "KEY2", maskedValue: "***abc", status: "ready" },
        ],
      },
      200,
      fakeReq,
    );
  });
});
