// ---------------------------------------------------------------------------
// Unit tests for PUT /api/skills/:plugin/:skill/file route
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  sendJson: vi.fn(),
  readBody: vi.fn(),
  resolveSkillDir: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeFileSync: mocks.writeFileSync,
    mkdirSync: mocks.mkdirSync,
  };
});

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

// ---------------------------------------------------------------------------
// Import and capture the PUT handler
// ---------------------------------------------------------------------------

// We need to capture the handler registered via router.put()
// Import the module to trigger route registration
const { registerRoutes } = await import("../api-routes.js");

function capturePutFileHandler(): (
  req: any,
  res: any,
  params: Record<string, string>,
) => Promise<void> {
  let putHandler: any = null;
  const fakeRouter = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn((path: string, handler: any) => {
      if (path === "/api/skills/:plugin/:skill/file") {
        putHandler = handler;
      }
    }),
  };
  registerRoutes(fakeRouter as any, "/root");
  if (!putHandler) throw new Error("PUT /api/skills/:plugin/:skill/file handler not registered");
  return putHandler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/skills/:plugin/:skill/file", () => {
  let handler: ReturnType<typeof capturePutFileHandler>;
  const fakeReq = {} as any;
  const fakeRes = {} as any;
  const params = { plugin: "myplugin", skill: "myskill" };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockReturnValue("/root/myplugin/myskill");
    handler = capturePutFileHandler();
  });

  it("saves a valid file and returns ok with size", async () => {
    mocks.readBody.mockResolvedValue({ path: "evals/evals.json", content: '{"test":true}' });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("evals"),
      { recursive: true },
    );
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      resolve(join("/root/myplugin/myskill", "evals/evals.json")),
      '{"test":true}',
      "utf-8",
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { ok: true, path: "evals/evals.json", size: 13 },
      200,
      fakeReq,
    );
  });

  it("rejects path traversal with 403", async () => {
    mocks.readBody.mockResolvedValue({ path: "../../../etc/passwd", content: "evil" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "Path traversal denied" },
      403,
      fakeReq,
    );
  });

  it("rejects missing path with 400", async () => {
    mocks.readBody.mockResolvedValue({ content: "hello" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "Missing path field" },
      400,
      fakeReq,
    );
  });

  it("rejects missing content with 400", async () => {
    mocks.readBody.mockResolvedValue({ path: "file.txt" });

    await handler(fakeReq, fakeRes, params);

    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "Missing content field" },
      400,
      fakeReq,
    );
  });
});
