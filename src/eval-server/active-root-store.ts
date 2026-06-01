// ---------------------------------------------------------------------------
// 0863 T-001: ActiveRootStore — runtime-mutable scan root.
//
// Before 0863, the eval-server resolved the scan root ONCE at boot and froze
// it into every route handler's closure, so switching the active project from
// the UI (POST /api/workspace/active) changed ~/.vskill/workspace.json but the
// running server kept serving the original folder's skills.
//
// This store holds the current scan root in memory and lets handlers read it
// per-request via `getRoot()`. `POST /api/workspace/active` calls `setRoot()`
// after persisting, so the next `GET /api/skills` scans the new folder — no
// process restart, no port change, no studio-token re-mint. The same code path
// works in `npx vskill studio` (single process) and the desktop Tauri sidecar.
// ---------------------------------------------------------------------------

import { loadWorkspace } from "./workspace-store.js";

export interface ActiveRootStore {
  /** The scan root all route handlers should use, resolved per request. */
  getRoot(): string;
  /** Replace the active scan root (e.g. after a project switch). */
  setRoot(root: string): void;
  /**
   * Re-derive the active root from `~/.vskill/workspace.json`'s active project.
   * Updates the store and returns the new value; if no active project resolves,
   * the current root is kept and returned.
   */
  reload(workspaceDir: string): string;
}

/**
 * Resolve the active project's path from the workspace registry. Returns null
 * when there is no workspace, no active project, or the active id is dangling.
 * Shared by both boot resolution (eval-server) and runtime reloads (this store).
 */
export function resolveActiveRoot(workspaceDir: string): string | null {
  try {
    const ws = loadWorkspace(workspaceDir);
    if (!ws.activeProjectId) return null;
    const active = ws.projects.find((p) => p.id === ws.activeProjectId);
    return active ? active.path : null;
  } catch {
    return null;
  }
}

export function createActiveRootStore(initialRoot: string): ActiveRootStore {
  let current = initialRoot;
  return {
    getRoot(): string {
      return current;
    },
    setRoot(root: string): void {
      current = root;
    },
    reload(workspaceDir: string): string {
      const resolved = resolveActiveRoot(workspaceDir);
      if (resolved) current = resolved;
      return current;
    },
  };
}
