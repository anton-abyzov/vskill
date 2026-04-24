// ---------------------------------------------------------------------------
// delete-endpoint.test.ts — regression test for DELETE /api/settings/keys/:provider
//
// Bug discovered by e2e-0702 verification: the handler used a 2-arg signature
// and tried to read params off the req object. The router passes params as
// the THIRD handler argument. Every call returned 400 "unknown provider:
// undefined" regardless of path.
//
// Fix contract: handler accepts (req, res, params), reads params.provider,
// validates with isProviderId, calls settings-store.removeKey, returns ok.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — isolate the DELETE handler from all side-effect heavy deps.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  // settings-store
  listKeys: vi.fn(),
  saveKey: vi.fn(),
  removeKey: vi.fn(),
  readKey: vi.fn(),
  mergeStoredKeysIntoEnv: vi.fn(),
  getKeysFilePath: vi.fn(() => "/tmp/keys.env"),
  hasKeySync: vi.fn(),
  readKeySync: vi.fn(),
  resetSettingsStore: vi.fn(),
  redactKey: vi.fn((s: string) => "****" + s.slice(-4)),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendJson: mocks.sendJson,
    readBody: mocks.readBody,
  };
});

vi.mock("../settings-store.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listKeys: mocks.listKeys,
    saveKey: mocks.saveKey,
    removeKey: mocks.removeKey,
    readKey: mocks.readKey,
    mergeStoredKeysIntoEnv: mocks.mergeStoredKeysIntoEnv,
    getKeysFilePath: mocks.getKeysFilePath,
    hasKeySync: mocks.hasKeySync,
    readKeySync: mocks.readKeySync,
    resetSettingsStore: mocks.resetSettingsStore,
    redactKey: mocks.redactKey,
  };
});

const { registerRoutes } = await import("../api-routes.js");

type Handler = (
  req: unknown,
  res: unknown,
  params: Record<string, string>,
) => Promise<void>;

function captureDeleteHandler(pathPattern: string): Handler {
  let captured: Handler | null = null;
  const fakeRouter = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn((p: string, h: Handler) => {
      if (p === pathPattern) captured = h;
    }),
  };
  registerRoutes(fakeRouter as never, "/root");
  if (!captured) throw new Error(`DELETE ${pathPattern} handler not registered`);
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/settings/keys/:provider (0702 regression)", () => {
  let handler: Handler;
  const fakeReq = {} as unknown;
  const fakeRes = {} as unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.removeKey.mockResolvedValue(undefined);
    mocks.getKeysFilePath.mockReturnValue("/tmp/keys.env");
    handler = captureDeleteHandler("/api/settings/keys/:provider");
  });

  it("extracts provider from the 3rd params argument and removes the key", async () => {
    await handler(fakeReq, fakeRes, { provider: "anthropic" });

    expect(mocks.removeKey).toHaveBeenCalledWith("anthropic");
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { ok: true });
  });

  it("accepts openai provider", async () => {
    await handler(fakeReq, fakeRes, { provider: "openai" });

    expect(mocks.removeKey).toHaveBeenCalledWith("openai");
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { ok: true });
  });

  it("accepts openrouter provider", async () => {
    await handler(fakeReq, fakeRes, { provider: "openrouter" });

    expect(mocks.removeKey).toHaveBeenCalledWith("openrouter");
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { ok: true });
  });

  it("rejects unknown provider with 400 + descriptive error", async () => {
    await handler(fakeReq, fakeRes, { provider: "bogus" });

    expect(mocks.removeKey).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "unknown provider: bogus" },
      400,
    );
  });

  it("is idempotent when nothing is stored (removeKey is a no-op)", async () => {
    // settings-store.removeKey is already documented as idempotent
    // (returns early when memoryMap.has(provider) is false).
    mocks.removeKey.mockResolvedValue(undefined);

    await handler(fakeReq, fakeRes, { provider: "openai" });

    expect(mocks.removeKey).toHaveBeenCalledWith("openai");
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { ok: true });
  });
});
