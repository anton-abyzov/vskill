// ---------------------------------------------------------------------------
// 0698 T-012: Workspace REST endpoints contract tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { makeWorkspaceHandlers } from "../workspace-routes.js";
import type { WorkspaceConfig } from "../workspace-store.js";
import { createActiveRootStore } from "../active-root-store.js";

// --- Minimal fake req/res helpers for pure-handler testing --------------------

class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  method = "GET";
  url = "/";
  body?: string;
  constructor(body?: unknown) {
    super();
    if (body !== undefined) {
      this.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    // Queue body emission on next tick so readBody() can subscribe first.
    if (this.body !== undefined) {
      process.nextTick(() => {
        this.emit("data", Buffer.from(this.body!));
        this.emit("end");
      });
    } else {
      process.nextTick(() => this.emit("end"));
    }
  }
}

class FakeRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    if (headers) Object.assign(this.headers, headers);
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  end(data?: string) {
    if (data !== undefined) this.body += data;
  }
  get json(): unknown {
    return JSON.parse(this.body);
  }
}

// -----------------------------------------------------------------------------

let tmpHome: string;
let workspaceDir: string;

function makeProjectPath(name: string): string {
  const dir = join(tmpHome, "projects", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "vskill-t012-"));
  workspaceDir = join(tmpHome, ".vskill");
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("GET /api/workspace (0698 T-012)", () => {
  it("returns default empty workspace when nothing registered", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const req = new FakeReq();
    const res = new FakeRes();
    await h.getWorkspace(req as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json as WorkspaceConfig;
    expect(body.version).toBe(1);
    expect(body.activeProjectId).toBeNull();
    expect(body.projects).toEqual([]);
  });
});

describe("POST /api/workspace/projects (0698 T-012)", () => {
  it("201 on valid add, workspace reflects the project", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const projectPath = makeProjectPath("alpha");
    const req = new FakeReq({ path: projectPath, name: "alpha" });
    const res = new FakeRes();
    await h.postProject(req as any, res as any);
    expect(res.statusCode).toBe(201);
    const body = res.json as WorkspaceConfig;
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].path).toBe(projectPath);
    expect(body.activeProjectId).toBe(body.projects[0].id);
  });

  it("400 on missing path", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const req = new FakeReq({});
    const res = new FakeRes();
    await h.postProject(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { ok: boolean }).ok).toBe(false);
  });

  it("409 on duplicate path", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const p = makeProjectPath("dup");
    const first = new FakeReq({ path: p });
    const firstRes = new FakeRes();
    await h.postProject(first as any, firstRes as any);
    const second = new FakeReq({ path: p });
    const secondRes = new FakeRes();
    await h.postProject(second as any, secondRes as any);
    expect(secondRes.statusCode).toBe(409);
  });

  it("400 when project path does not exist on disk", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const req = new FakeReq({ path: join(tmpHome, "does-not-exist") });
    const res = new FakeRes();
    await h.postProject(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/does not exist/i);
  });
});

describe("DELETE /api/workspace/projects/:id (0698 T-012)", () => {
  it("200 on valid delete; workspace shows project removed", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const p = makeProjectPath("delete-me");
    const addReq = new FakeReq({ path: p });
    const addRes = new FakeRes();
    await h.postProject(addReq as any, addRes as any);
    const id = (addRes.json as WorkspaceConfig).projects[0].id;

    const delReq = new FakeReq();
    const delRes = new FakeRes();
    await h.deleteProject(delReq as any, delRes as any, { id });
    expect(delRes.statusCode).toBe(200);
    const body = delRes.json as WorkspaceConfig;
    expect(body.projects).toHaveLength(0);
    expect(body.activeProjectId).toBeNull();
  });

  it("404 on unknown id", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const delReq = new FakeReq();
    const delRes = new FakeRes();
    await h.deleteProject(delReq as any, delRes as any, { id: "zzz-missing" });
    expect(delRes.statusCode).toBe(404);
  });
});

describe("POST /api/workspace/active (0698 T-012)", () => {
  it("200 on setting active to a known id", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const pa = makeProjectPath("a");
    const pb = makeProjectPath("b");
    await h.postProject(new FakeReq({ path: pa }) as any, new FakeRes() as any);
    const addBRes = new FakeRes();
    await h.postProject(new FakeReq({ path: pb }) as any, addBRes as any);
    const bId = (addBRes.json as WorkspaceConfig).projects[1].id;

    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: bId }) as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json as WorkspaceConfig;
    expect(body.activeProjectId).toBe(bId);
  });

  it("404 on unknown id", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: "nope" }) as any, res as any);
    expect(res.statusCode).toBe(404);
  });

  it("200 on null (clears active)", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const p = makeProjectPath("will-clear");
    await h.postProject(new FakeReq({ path: p }) as any, new FakeRes() as any);

    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: null }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.json as WorkspaceConfig).activeProjectId).toBeNull();
  });

  it("400 when id field is missing or wrong type", async () => {
    const h = makeWorkspaceHandlers({ workspaceDir });
    const res = new FakeRes();
    await h.postActive(new FakeReq({}) as any, res as any);
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/workspace/active re-roots the running server (0863)", () => {
  it("AC-US1-03/05: switching to a valid project sets the store root + returns skillCount", async () => {
    const pa = makeProjectPath("a");
    const pb = makeProjectPath("b");
    const rootStore = createActiveRootStore(pa);
    const h = makeWorkspaceHandlers({
      workspaceDir,
      rootStore,
      countSkills: async (r) => (r === pb ? 3 : 0),
    });
    await h.postProject(new FakeReq({ path: pa }) as any, new FakeRes() as any);
    const addBRes = new FakeRes();
    await h.postProject(new FakeReq({ path: pb }) as any, addBRes as any);
    const bId = (addBRes.json as WorkspaceConfig).projects[1].id;

    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: bId }) as any, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json as { ok: boolean; root: string; skillCount: number; activeProjectId: string };
    expect(body.ok).toBe(true);
    expect(body.root).toBe(pb);
    expect(body.skillCount).toBe(3);
    expect(body.activeProjectId).toBe(bId);
    // The running server is now re-rooted to B.
    expect(rootStore.getRoot()).toBe(pb);
  });

  it("AC-US4-01: switching to an empty folder succeeds with skillCount 0 (not an error)", async () => {
    const pa = makeProjectPath("a");
    const empty = makeProjectPath("empty");
    const rootStore = createActiveRootStore(pa);
    const h = makeWorkspaceHandlers({
      workspaceDir,
      rootStore,
      countSkills: async () => 0,
    });
    await h.postProject(new FakeReq({ path: pa }) as any, new FakeRes() as any);
    const addRes = new FakeRes();
    await h.postProject(new FakeReq({ path: empty }) as any, addRes as any);
    const emptyId = (addRes.json as WorkspaceConfig).projects[1].id;

    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: emptyId }) as any, res as any);

    expect(res.statusCode).toBe(200);
    const body = res.json as { ok: boolean; skillCount: number };
    expect(body.ok).toBe(true);
    expect(body.skillCount).toBe(0);
    expect(rootStore.getRoot()).toBe(empty);
  });

  it("AC-US4-02: 409 + fallbackCommand when the target path is gone; old root preserved", async () => {
    const pa = makeProjectPath("a");
    const pb = makeProjectPath("b");
    const rootStore = createActiveRootStore(pa);
    const h = makeWorkspaceHandlers({ workspaceDir, rootStore, countSkills: async () => 9 });
    await h.postProject(new FakeReq({ path: pa }) as any, new FakeRes() as any);
    const addBRes = new FakeRes();
    await h.postProject(new FakeReq({ path: pb }) as any, addBRes as any);
    const bId = (addBRes.json as WorkspaceConfig).projects[1].id;

    // Delete B's folder AFTER registering it.
    rmSync(pb, { recursive: true, force: true });

    const res = new FakeRes();
    await h.postActive(new FakeReq({ id: bId }) as any, res as any);

    expect(res.statusCode).toBe(409);
    const body = res.json as { ok: boolean; error: string; fallbackCommand: string };
    expect(body.ok).toBe(false);
    expect(body.fallbackCommand).toContain(pb);
    expect(body.fallbackCommand).toContain("npx vskill@latest studio");
    // The store keeps serving the previous (still-valid) root.
    expect(rootStore.getRoot()).toBe(pa);
  });
});
