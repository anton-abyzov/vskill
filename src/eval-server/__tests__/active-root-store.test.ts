import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActiveRootStore, resolveActiveRoot } from "../active-root-store.js";
import { projectIdFromPath } from "../workspace-store.js";

const tmps: string[] = [];
function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "vskill-arstore-"));
  tmps.push(dir);
  return dir;
}

afterEach(() => {
  while (tmps.length) {
    const d = tmps.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("ActiveRootStore (0863 T-001)", () => {
  it("returns the initial root", () => {
    const store = createActiveRootStore("/projects/alpha");
    expect(store.getRoot()).toBe("/projects/alpha");
  });

  it("setRoot replaces the active root", () => {
    const store = createActiveRootStore("/projects/alpha");
    store.setRoot("/projects/beta");
    expect(store.getRoot()).toBe("/projects/beta");
  });

  it("reload re-derives the active project's path from workspace.json", () => {
    const wsDir = tmpWorkspace();
    const path = "/projects/gamma";
    const id = projectIdFromPath(path);
    writeFileSync(
      join(wsDir, "workspace.json"),
      JSON.stringify({
        version: 1,
        activeProjectId: id,
        projects: [
          { id, name: "gamma", path, colorDot: "oklch(0.7 0.1 200)", addedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    const store = createActiveRootStore("/projects/alpha");
    expect(store.reload(wsDir)).toBe(path);
    expect(store.getRoot()).toBe(path);
  });

  it("reload keeps the current root when no active project resolves", () => {
    const wsDir = tmpWorkspace();
    writeFileSync(
      join(wsDir, "workspace.json"),
      JSON.stringify({ version: 1, activeProjectId: null, projects: [] }),
    );
    const store = createActiveRootStore("/projects/alpha");
    expect(store.reload(wsDir)).toBe("/projects/alpha");
    expect(store.getRoot()).toBe("/projects/alpha");
  });

  it("resolveActiveRoot returns null for a missing workspace dir", () => {
    expect(resolveActiveRoot(join(tmpdir(), "does-not-exist-vskill-xyz"))).toBeNull();
  });
});
