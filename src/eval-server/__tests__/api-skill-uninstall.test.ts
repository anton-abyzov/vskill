// ---------------------------------------------------------------------------
// 0780 US-003 — POST /api/skills/:plugin/:skill/uninstall
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Stub `trash` — we don't need to touch the OS recycle bin in tests; we
// just need to assert the call happened and the skill dir got removed.
vi.mock("trash", () => ({
  default: vi.fn(async (paths: string[]) => {
    // Mimic the trash package's behavior — remove the dir without touching OS trash.
    for (const p of paths) {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  }),
}));

// Defer the import so the trash mock is in place first.
let registerRoutes: typeof import("../api-routes.js").registerRoutes;

interface Captured {
  body: string;
  status: number;
  headers: Record<string, string>;
}

function fakeReq(body?: unknown): unknown {
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  return {
    method: "POST",
    url: "/api/skills/X/Y/uninstall",
    headers: { accept: "application/json", "content-type": "application/json", host: "127.0.0.1:3077" },
    on: (event: string, callback: (chunk?: Buffer) => void) => {
      if (event === "data" && bodyStr) setImmediate(() => callback(Buffer.from(bodyStr)));
      else if (event === "end") setImmediate(() => callback());
    },
  };
}

function fakeRes(): Captured & {
  writeHead: (s: number, h?: Record<string, string>) => void;
  write: (c: string | Buffer) => void;
  end: (c?: string | Buffer) => void;
  setHeader: (k: string, v: string) => void;
  headersSent: boolean;
  on: () => void;
} {
  const captured: Captured = { body: "", status: 0, headers: {} };
  return {
    ...captured,
    writeHead(status: number, h?: Record<string, string>) {
      captured.status = status;
      if (h) captured.headers = { ...captured.headers, ...h };
    },
    write(chunk: string | Buffer) {
      captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    setHeader(k: string, v: string) { captured.headers[k] = v; },
    headersSent: false,
    on: vi.fn(),
    get capturedBody() { return captured.body; },
    get capturedStatus() { return captured.status; },
  } as never;
}

interface RouterStub {
  handlers: Record<string, (req: unknown, res: unknown, params: Record<string, string>) => Promise<void>>;
}

function makeRouter(): RouterStub & {
  get: (p: string, h: never) => void;
  post: (p: string, h: never) => void;
  put: (p: string, h: never) => void;
  delete: (p: string, h: never) => void;
} {
  const handlers: RouterStub["handlers"] = {};
  return {
    handlers,
    get: () => {},
    post(path: string, handler: never) { handlers[`POST ${path}`] = handler as never; },
    put: () => {},
    delete: () => {},
  } as never;
}

async function runHandler(
  handler: (req: unknown, res: unknown, params: Record<string, string>) => Promise<void>,
  params: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = fakeRes() as never as { capturedStatus: number; capturedBody: string };
  await (handler as (req: unknown, res: unknown, params: Record<string, string>) => Promise<void>)(
    fakeReq(),
    res,
    params,
  );
  await new Promise((r) => setImmediate(r));
  return {
    status: (res as never as { capturedStatus: number }).capturedStatus,
    body: JSON.parse((res as never as { capturedBody: string }).capturedBody) as Record<string, unknown>,
  };
}

describe("POST /api/skills/:plugin/:skill/uninstall (0780 US-003)", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "vskill-uninstall-"));
    if (!registerRoutes) {
      registerRoutes = (await import("../api-routes.js")).registerRoutes;
    }
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function setupHandler() {
    const r = makeRouter();
    registerRoutes(r as never, root);
    const handler = r.handlers["POST /api/skills/:plugin/:skill/uninstall"];
    if (!handler) throw new Error("uninstall handler not registered");
    return handler;
  }

  function writeLock(skills: Record<string, unknown>): void {
    writeFileSync(
      join(root, "vskill.lock"),
      JSON.stringify({ version: 1, agents: ["claude-code"], skills, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  }

  function writeSkillDir(name: string): string {
    const dir = join(root, ".claude", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: " + name + "\n---\n# " + name, "utf-8");
    return dir;
  }

  it("AC-US3-01/02: lockfile entry + disk dir → both removed, ok=true", async () => {
    writeLock({ "greet-anton": { version: "1.0.3", source: "github:anton-abyzov/greet-anton", scope: "project", files: ["SKILL.md"] } });
    const skillDir = writeSkillDir("greet-anton");
    const handler = setupHandler();
    const { status, body } = await runHandler(handler, { plugin: "anton-abyzov", skill: "greet-anton" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.removedFromLockfile).toBe(true);
    expect(body.trashedDir).toBe(skillDir);
    // Disk dir gone
    expect(existsSync(skillDir)).toBe(false);
    // Lockfile entry gone
    const lock = JSON.parse(readFileSync(join(root, "vskill.lock"), "utf-8")) as { skills: Record<string, unknown> };
    expect(lock.skills["greet-anton"]).toBeUndefined();
  });

  it("AC-US3-03: lockfile entry but disk dir missing → ok with trashedDir=null", async () => {
    writeLock({ "greet-anton": { version: "1.0.3", source: "x", scope: "project", files: [] } });
    const handler = setupHandler();
    const { status, body } = await runHandler(handler, { plugin: "anton-abyzov", skill: "greet-anton" });
    expect(status).toBe(200);
    expect(body.removedFromLockfile).toBe(true);
    expect(body.trashedDir).toBeNull();
  });

  it("AC-US3-03 (0786): disk dir but no lockfile entry → 422 not-installed (lockfile-first gate)", async () => {
    // 0786: under the lockfile-first gate, a source-authored skill (disk dir
    // present, no lockfile entry) MUST be rejected as not-installed so the
    // UI can route the user to Delete instead of returning a misleading
    // 200 ok. The disk dir is left untouched — Delete is the correct path.
    writeLock({ "other-skill": { version: "1.0.0", source: "x", scope: "project", files: [] } });
    const dir = writeSkillDir("greet-anton");
    const handler = setupHandler();
    const { status, body } = await runHandler(handler, { plugin: "anton-abyzov", skill: "greet-anton" });
    expect(status).toBe(422);
    expect(body.code).toBe("not-installed");
    // Disk dir untouched — Delete (DELETE /api/skills/...) is the right path.
    expect(existsSync(dir)).toBe(true);
  });

  it("AC-US3-03 (0786): neither lockfile entry nor disk dir → 422 not-installed", async () => {
    // 0786: lockfile-first gate fires before any filesystem access; status
    // is 422 (was 404 pre-0786) so the Studio onFailure handler can render
    // the friendly "use Delete instead" toast.
    writeLock({});
    const handler = setupHandler();
    const { status, body } = await runHandler(handler, { plugin: "anton-abyzov", skill: "greet-anton" });
    expect(status).toBe(422);
    expect(body.code).toBe("not-installed");
  });

  it("AC-US3-06: invalid skill name (path traversal) → 400 BEFORE filesystem access", async () => {
    const trashMock = (await import("trash")).default as ReturnType<typeof vi.fn>;
    const handler = setupHandler();
    const { status, body } = await runHandler(handler, { plugin: "anton-abyzov", skill: "../../etc/passwd" });
    expect(status).toBe(400);
    expect(body.code).toBe("invalid-skill-name");
    expect(trashMock).not.toHaveBeenCalled();
  });
});
