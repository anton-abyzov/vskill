// ---------------------------------------------------------------------------
// api-routes-skill-delete.test.ts — DELETE /api/skills/:plugin/:skill (0722)
//
// Increment 0722 changes the skill DELETE handler to send the folder to the
// OS trash via the `trash` npm package instead of hard-deleting via rmSync.
// The plugin/installed-origin guard (403) is preserved.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  trash: vi.fn(),
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  classifyOrigin: vi.fn(),
  resolveSkillDir: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendJson: mocks.sendJson,
    readBody: mocks.readBody,
  };
});

vi.mock("trash", () => ({
  default: mocks.trash,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: (...a: unknown[]) => mocks.existsSync(...a),
    rmSync: (...a: unknown[]) => mocks.rmSync(...a),
  };
});

vi.mock("../skill-resolver.js", () => ({
  resolveSkillDir: (...a: unknown[]) => mocks.resolveSkillDir(...a),
}));

vi.mock("../../eval/skill-scanner.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    classifyOrigin: (...a: unknown[]) => mocks.classifyOrigin(...a),
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

describe("DELETE /api/skills/:plugin/:skill (0722 — OS trash)", () => {
  let handler: Handler;
  const fakeReq = {} as unknown;
  const fakeRes = {} as unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveSkillDir.mockImplementation(
      (root: string, plugin: string, skill: string) => `${root}/${plugin}/${skill}`,
    );
    mocks.existsSync.mockReturnValue(true);
    mocks.trash.mockResolvedValue(undefined);
    handler = captureDeleteHandler("/api/skills/:plugin/:skill");
  });

  it("rejects plugin/installed skills with 403 and does NOT call trash", async () => {
    mocks.classifyOrigin.mockReturnValue("installed");

    await handler(fakeReq, fakeRes, { plugin: "vskill", skill: "tournament-manager" });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.rmSync).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "Cannot delete installed (read-only) skill" },
      403,
      fakeReq,
    );
  });

  it("source-origin skills are sent to OS trash via the `trash` package", async () => {
    mocks.classifyOrigin.mockReturnValue("source");

    await handler(fakeReq, fakeRes, { plugin: "easychamp", skill: "greet-anton" });

    expect(mocks.trash).toHaveBeenCalledTimes(1);
    expect(mocks.trash).toHaveBeenCalledWith(["/root/easychamp/greet-anton"]);
    expect(mocks.rmSync).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { ok: true, deleted: "easychamp/greet-anton" },
      200,
      fakeReq,
    );
  });

  it("returns 404 when the skill folder does not exist", async () => {
    mocks.existsSync.mockReturnValue(false);

    await handler(fakeReq, fakeRes, { plugin: "easychamp", skill: "ghost" });

    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "Skill directory not found" },
      404,
      fakeReq,
    );
  });

  it("returns 500 with structured error when trash() rejects", async () => {
    mocks.classifyOrigin.mockReturnValue("source");
    mocks.trash.mockRejectedValue(new Error("EACCES: permission denied"));

    await handler(fakeReq, fakeRes, { plugin: "easychamp", skill: "greet-anton" });

    expect(mocks.trash).toHaveBeenCalledTimes(1);
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      expect.objectContaining({
        error: expect.stringContaining("EACCES: permission denied"),
      }),
      500,
      fakeReq,
    );
  });
});
