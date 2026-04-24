// ---------------------------------------------------------------------------
// 0698 T-011: workspace-store — user-global registry at ~/.vskill/workspace.json
//
// Atomic CRUD over ProjectConfig[] with:
//   - seed-on-first-load (creates default empty config if file missing)
//   - atomic write (tmp + rename) so a crash mid-write can't corrupt
//   - stable id = hash(absolutePath) — collision-safe, survives display renames
//   - duplicate-path rejection
//   - unknown-id 404
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWorkspace,
  addProject,
  removeProject,
  setActiveProject,
  projectIdFromPath,
} from "../workspace-store.js";

let tmpHome: string;
let workspaceDir: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "vskill-t011-home-"));
  workspaceDir = join(tmpHome, ".vskill");
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

function makeProjectPath(name: string): string {
  const dir = join(tmpHome, "projects", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadWorkspace (0698 T-011)", () => {
  it("seeds a default empty config when workspace.json does not exist", () => {
    const ws = loadWorkspace(workspaceDir);
    expect(ws.version).toBe(1);
    expect(ws.activeProjectId).toBeNull();
    expect(ws.projects).toEqual([]);
  });

  it("reads an existing workspace.json round-trippably", () => {
    const ws1 = loadWorkspace(workspaceDir);
    const p = makeProjectPath("alpha");
    const updated = addProject(workspaceDir, ws1, { path: p, name: "alpha" });
    const ws2 = loadWorkspace(workspaceDir);
    expect(ws2.projects).toHaveLength(1);
    expect(ws2.projects[0].path).toBe(p);
    expect(ws2.activeProjectId).toBe(updated.activeProjectId);
  });

  it("repairs a corrupt workspace.json by re-seeding default", () => {
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, "workspace.json"), "{not valid json");
    const ws = loadWorkspace(workspaceDir);
    expect(ws.version).toBe(1);
    expect(ws.projects).toEqual([]);
  });
});

describe("addProject (0698 T-011)", () => {
  it("adds a new project and assigns a stable id derived from path", () => {
    const ws1 = loadWorkspace(workspaceDir);
    const p = makeProjectPath("alpha");
    const ws2 = addProject(workspaceDir, ws1, { path: p, name: "alpha" });
    expect(ws2.projects).toHaveLength(1);
    expect(ws2.projects[0].id).toBe(projectIdFromPath(p));
  });

  it("promotes the first added project to activeProjectId automatically", () => {
    const ws1 = loadWorkspace(workspaceDir);
    const p = makeProjectPath("solo");
    const ws2 = addProject(workspaceDir, ws1, { path: p });
    expect(ws2.activeProjectId).toBe(projectIdFromPath(p));
  });

  it("rejects adding a path that already exists (throws)", () => {
    let ws = loadWorkspace(workspaceDir);
    const p = makeProjectPath("dup");
    ws = addProject(workspaceDir, ws, { path: p });
    expect(() => addProject(workspaceDir, ws, { path: p })).toThrow(/duplicate|already/i);
  });

  it("rejects a path that does not exist on disk (throws)", () => {
    const ws = loadWorkspace(workspaceDir);
    expect(() =>
      addProject(workspaceDir, ws, { path: join(tmpHome, "nonexistent") }),
    ).toThrow(/does not exist|not found/i);
  });

  it("writes atomically — workspace.json is valid JSON after every add", () => {
    let ws = loadWorkspace(workspaceDir);
    const a = makeProjectPath("a");
    const b = makeProjectPath("b");
    ws = addProject(workspaceDir, ws, { path: a });
    ws = addProject(workspaceDir, ws, { path: b });
    const onDisk = JSON.parse(readFileSync(join(workspaceDir, "workspace.json"), "utf8"));
    expect(onDisk.projects).toHaveLength(2);
    expect(onDisk.version).toBe(1);
  });

  it("computes a deterministic colorDot per path (stable across invocations)", () => {
    const ws1 = loadWorkspace(workspaceDir);
    const p = makeProjectPath("colored");
    const ws2 = addProject(workspaceDir, ws1, { path: p });
    const color1 = ws2.projects[0].colorDot;
    expect(color1).toMatch(/^oklch\(/);

    // Same path in a fresh workspace yields the same color
    const freshHome = mkdtempSync(join(tmpdir(), "vskill-t011-color-"));
    const freshDir = join(freshHome, ".vskill");
    const wsFresh = loadWorkspace(freshDir);
    const wsFresh2 = addProject(freshDir, wsFresh, { path: p });
    expect(wsFresh2.projects[0].colorDot).toBe(color1);
    rmSync(freshHome, { recursive: true, force: true });
  });
});

describe("removeProject (0698 T-011)", () => {
  it("removes a project by id and persists", () => {
    let ws = loadWorkspace(workspaceDir);
    const p = makeProjectPath("gone");
    ws = addProject(workspaceDir, ws, { path: p });
    const id = ws.projects[0].id;
    ws = removeProject(workspaceDir, ws, id);
    expect(ws.projects).toHaveLength(0);
  });

  it("clears activeProjectId if the removed project was active", () => {
    let ws = loadWorkspace(workspaceDir);
    const p = makeProjectPath("active-target");
    ws = addProject(workspaceDir, ws, { path: p });
    expect(ws.activeProjectId).not.toBeNull();
    ws = removeProject(workspaceDir, ws, ws.projects[0]!.id);
    expect(ws.activeProjectId).toBeNull();
  });

  it("throws on unknown id", () => {
    const ws = loadWorkspace(workspaceDir);
    expect(() => removeProject(workspaceDir, ws, "nonexistent-id")).toThrow(/not found|unknown/i);
  });
});

describe("setActiveProject (0698 T-011)", () => {
  it("updates activeProjectId and bumps lastActiveAt", () => {
    let ws = loadWorkspace(workspaceDir);
    const a = makeProjectPath("proj-a");
    const b = makeProjectPath("proj-b");
    ws = addProject(workspaceDir, ws, { path: a });
    ws = addProject(workspaceDir, ws, { path: b });
    const bId = ws.projects[1].id;
    const before = ws.projects[1].lastActiveAt ?? null;
    ws = setActiveProject(workspaceDir, ws, bId);
    expect(ws.activeProjectId).toBe(bId);
    expect(ws.projects[1].lastActiveAt).not.toBe(before);
  });

  it("throws on unknown id", () => {
    const ws = loadWorkspace(workspaceDir);
    expect(() => setActiveProject(workspaceDir, ws, "zzz")).toThrow(/not found|unknown/i);
  });

  it("accepts null to clear active selection", () => {
    let ws = loadWorkspace(workspaceDir);
    const p = makeProjectPath("will-clear");
    ws = addProject(workspaceDir, ws, { path: p });
    ws = setActiveProject(workspaceDir, ws, null);
    expect(ws.activeProjectId).toBeNull();
  });
});

describe("projectIdFromPath (0698 T-011)", () => {
  it("returns stable ids for the same absolute path", () => {
    const a = projectIdFromPath("/Users/foo/project-a");
    const b = projectIdFromPath("/Users/foo/project-a");
    expect(a).toBe(b);
  });

  it("returns distinct ids for distinct paths", () => {
    const a = projectIdFromPath("/Users/foo/project-a");
    const b = projectIdFromPath("/Users/foo/project-b");
    expect(a).not.toBe(b);
  });

  it("produces a short readable id (not a raw 64-char hex)", () => {
    const id = projectIdFromPath("/a/b/c");
    expect(id.length).toBeLessThanOrEqual(16);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe("workspace.json file management (0698 T-011)", () => {
  it("creates the workspace dir on first use", () => {
    expect(existsSync(workspaceDir)).toBe(false);
    loadWorkspace(workspaceDir);
    // loadWorkspace alone does NOT create the dir — only persists on write
    // but addProject must create the dir.
    const ws = loadWorkspace(workspaceDir);
    const p = makeProjectPath("x");
    addProject(workspaceDir, ws, { path: p });
    expect(existsSync(workspaceDir)).toBe(true);
    expect(existsSync(join(workspaceDir, "workspace.json"))).toBe(true);
  });
});
