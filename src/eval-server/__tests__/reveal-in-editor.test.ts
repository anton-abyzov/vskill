// ---------------------------------------------------------------------------
// reveal-in-editor.test.ts — 0820: POST /api/skills/reveal-in-editor
//
// Mirrors the api-routes-skill-delete.test.ts mocking pattern. We capture the
// route handler off a fake router, mock scanSkillInstallLocations and the
// resolve-editor helper, and assert sendJson outcomes for each AC scenario.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
  scanSkillInstallLocations: vi.fn(),
  resolveEditorCommand: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendJson: mocks.sendJson,
    readBody: mocks.readBody,
  };
});

vi.mock("../utils/scan-install-locations.js", async () => {
  // Keep the real `pickHighestPrecedenceLocation` (pure helper) so the route
  // still picks a winner from whatever scanSkillInstallLocations returns.
  const actual = await vi.importActual<typeof import("../utils/scan-install-locations.js")>(
    "../utils/scan-install-locations.js",
  );
  return {
    ...actual,
    scanSkillInstallLocations: (...a: unknown[]) =>
      mocks.scanSkillInstallLocations(...a),
  };
});

vi.mock("../utils/resolve-editor.js", async () => {
  // Re-import the real NoEditorError so error-class checks work.
  const actual = await vi.importActual<
    typeof import("../utils/resolve-editor.js")
  >("../utils/resolve-editor.js");
  return {
    ...actual,
    resolveEditorCommand: (...a: unknown[]) => mocks.resolveEditorCommand(...a),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    spawn: (...a: unknown[]) => mocks.spawn(...a),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: (...a: unknown[]) => mocks.existsSync(...a),
  };
});

const { registerRoutes } = await import("../api-routes.js");
const { NoEditorError } = await import("../utils/resolve-editor.js");

type Handler = (req: unknown, res: unknown, params?: Record<string, string>) => Promise<void>;

function captureHandler(method: "post", path: string): Handler {
  let captured: Handler | null = null;
  const fakeRouter: Record<string, unknown> = {
    get: vi.fn(),
    post: vi.fn((p: string, h: Handler) => {
      if (p === path) captured = h;
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerRoutes(fakeRouter as never, "/root");
  if (!captured) throw new Error(`${method.toUpperCase()} ${path} handler not registered`);
  return captured;
}

/** Build a fake child process that emits `spawn` next tick. */
function fakeSpawn(): EventEmitter & { unref: () => void } {
  const cp = new EventEmitter() as EventEmitter & { unref: () => void };
  cp.unref = vi.fn();
  setImmediate(() => cp.emit("spawn"));
  return cp;
}

/** Build a fake child process that emits `error` next tick. */
function fakeSpawnError(err: Error): EventEmitter & { unref: () => void } {
  const cp = new EventEmitter() as EventEmitter & { unref: () => void };
  cp.unref = vi.fn();
  setImmediate(() => cp.emit("error", err));
  return cp;
}

describe("POST /api/skills/reveal-in-editor (0820)", () => {
  let handler: Handler;
  const fakeReq = {} as unknown;
  const fakeRes = {} as unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    handler = captureHandler("post", "/api/skills/reveal-in-editor");
    mocks.scanSkillInstallLocations.mockReturnValue([
      { scope: "project", agent: "claude-code", agentLabel: "CC", dir: "/r/p/skills/s", symlinked: false, readonly: false },
    ]);
    mocks.resolveEditorCommand.mockReturnValue({ command: "code", args: ["/r/p/skills/s/SKILL.md"] });
    mocks.spawn.mockImplementation(() => fakeSpawn());
    mocks.existsSync.mockReturnValue(true);
  });

  it("happy path: file=SKILL.md → spawns editor, returns 200", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "SKILL.md" });

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    // F-006: lock the route → spawn wiring (cmd + argv + detached/ignore opts)
    // so a future regression that swaps `spawn` for a shell call breaks loudly.
    expect(mocks.spawn).toHaveBeenCalledWith(
      "code",
      ["/r/p/skills/s/SKILL.md"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      expect.objectContaining({ ok: true, command: "code" }),
      200,
      fakeReq,
    );
  });

  it("no file: spawn target is the dir", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s" });
    mocks.resolveEditorCommand.mockImplementation((target: { dir: string; file?: string }) => ({
      command: "code",
      args: [target.file ? `${target.dir}/${target.file}` : target.dir],
    }));

    await handler(fakeReq, fakeRes);

    const target = mocks.resolveEditorCommand.mock.calls[0]![0] as { dir: string; file?: string };
    expect(target.dir).toBe("/r/p/skills/s");
    expect(target.file).toBeUndefined();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      expect.objectContaining({ ok: true }),
      200,
      fakeReq,
    );
  });

  it("skill not found → 404 skill_not_found", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "missing", file: "SKILL.md" });
    mocks.scanSkillInstallLocations.mockReturnValue([]);

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "skill_not_found" },
      404,
      fakeReq,
    );
  });

  it("file with traversal (..) → 400 invalid_file", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "../etc/passwd" });

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_file" }, 400, fakeReq);
  });

  it("file with separator (/) → 400 invalid_file", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "sub/x" });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_file" }, 400, fakeReq);
  });

  it("file with backslash (\\) → 400 invalid_file", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "sub\\x" });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_file" }, 400, fakeReq);
  });

  it.each([
    ["number", 123],
    ["null", null],
    ["array", ["a"]],
    ["object", { f: "x" }],
    ["empty string", ""],
  ])("non-string file (%s) → 400 invalid_file", async (_label, file) => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file });

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_file" }, 400, fakeReq);
  });

  it.each([
    ["number plugin", { plugin: 1, skill: "s" }],
    ["null skill", { plugin: "p", skill: null }],
    ["array skill", { plugin: "p", skill: ["s"] }],
  ])("non-string %s → 400 invalid_body", async (_label, body) => {
    mocks.readBody.mockResolvedValue(body);

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_body" }, 400, fakeReq);
  });

  it("missing plugin in body → 400 invalid_body", async () => {
    mocks.readBody.mockResolvedValue({ skill: "s" });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_body" }, 400, fakeReq);
  });

  it("missing skill in body → 400 invalid_body", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p" });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "invalid_body" }, 400, fakeReq);
  });

  it("file is clean basename but missing on disk → 404 file_not_found", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "MISSING.md" });
    mocks.existsSync.mockImplementation((p: string) => !p.endsWith("MISSING.md"));

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "file_not_found" }, 404, fakeReq);
  });

  it("resolveEditorCommand throws non-NoEditorError → 500 resolve_failed", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "SKILL.md" });
    mocks.resolveEditorCommand.mockImplementation(() => {
      throw new Error("unexpected resolver bug");
    });

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "resolve_failed" }, 500, fakeReq);
  });

  it("resolveEditorCommand throws NoEditorError → 500 no_editor", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "SKILL.md" });
    mocks.resolveEditorCommand.mockImplementation(() => {
      throw new NoEditorError();
    });

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "no_editor" }, 500, fakeReq);
  });

  it("spawn emits 'error' (ENOENT) → 500 spawn_failed", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s", file: "SKILL.md" });
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mocks.spawn.mockImplementation(() => fakeSpawnError(enoent));

    await handler(fakeReq, fakeRes);

    expect(mocks.sendJson).toHaveBeenCalledWith(fakeRes, { error: "spawn_failed" }, 500, fakeReq);
  });

  it("defense-in-depth: rejects when scanner returns a dir whose basename != skill", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "expected", file: "SKILL.md" });
    // Simulate a future regression where the scanner returns a parent or
    // sibling dir. The handler must refuse rather than spawn the editor on
    // an unexpected path.
    mocks.scanSkillInstallLocations.mockReturnValue([
      { scope: "project", agent: "claude-code", agentLabel: "CC", dir: "/r/p/skills/wrong-slug", symlinked: false, readonly: false },
    ]);

    await handler(fakeReq, fakeRes);

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.sendJson).toHaveBeenCalledWith(
      fakeRes,
      { error: "skill_not_found" },
      404,
      fakeReq,
    );
  });

  it("multi-scope: project install is preferred over plugin", async () => {
    mocks.readBody.mockResolvedValue({ plugin: "p", skill: "s" });
    mocks.scanSkillInstallLocations.mockReturnValue([
      { scope: "plugin", agent: "claude-code", agentLabel: "CC", dir: "/cache/p/skills/s", symlinked: false, readonly: true },
      { scope: "project", agent: "claude-code", agentLabel: "CC", dir: "/r/p/skills/s", symlinked: false, readonly: false },
    ]);
    mocks.resolveEditorCommand.mockImplementation((target: { dir: string }) => ({
      command: "code",
      args: [target.dir],
    }));

    await handler(fakeReq, fakeRes);

    const target = mocks.resolveEditorCommand.mock.calls[0]![0] as { dir: string };
    expect(target.dir).toBe("/r/p/skills/s");
  });
});
