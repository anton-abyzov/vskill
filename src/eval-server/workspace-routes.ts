// ---------------------------------------------------------------------------
// 0698 T-012: workspace REST endpoints.
//
//   GET    /api/workspace                 → WorkspaceConfig
//   POST   /api/workspace/projects        { path, name? }  → WorkspaceConfig
//   DELETE /api/workspace/projects/:id    → WorkspaceConfig
//   POST   /api/workspace/active          { id | null }    → WorkspaceConfig (+0863 fields)
//
// Error envelope (non-2xx): { ok: false, error: <sanitized message> }.
// 400 duplicate / 404 unknown id / 400 path-does-not-exist.
//
// 0863: POST /api/workspace/active now also RE-ROOTS the running eval-server.
// When a `rootStore` is injected, switching to a project updates the in-memory
// scan root so the next GET /api/skills scans the new folder — no restart. The
// success body becomes { ok:true, ...WorkspaceConfig, root, skillCount }. If the
// target path is missing/unreadable, the active project is NOT changed, the old
// root keeps being served, and the handler returns 409 with a `fallbackCommand`
// the UI can surface (the legacy "relaunch from a terminal" hint).
//
// Handlers are exported as pure functions (`makeWorkspaceHandlers`) so tests
// can call them directly with fake req/res. The Router registration wrapper
// (`registerWorkspaceRoutes`) is a thin shim over the handlers.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { statSync } from "node:fs";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import {
  loadWorkspace,
  addProject,
  removeProject,
  setActiveProject,
} from "./workspace-store.js";
import type { WorkspaceConfig } from "./workspace-store.js";
import type { ActiveRootStore } from "./active-root-store.js";

export interface WorkspaceRoutesOptions {
  /** Where ~/.vskill lives (test injection). Defaults to join(os.homedir(), ".vskill"). */
  workspaceDir: string;
  /**
   * 0863: when present, switching the active project re-roots the running
   * server via `rootStore.setRoot(path)`. Omitted in unit tests that only
   * exercise the persistence layer (those keep the legacy response shape).
   */
  rootStore?: ActiveRootStore;
  /**
   * 0863: counts skills under a root for the switch response (`skillCount`),
   * so the UI can size its skeleton grid and toast. Best-effort: errors → undefined.
   */
  countSkills?: (root: string) => Promise<number>;
}

export interface WorkspaceHandlers {
  getWorkspace: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  postProject: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  deleteProject: (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => Promise<void>;
  postActive: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

export function makeWorkspaceHandlers(
  opts: WorkspaceRoutesOptions,
): WorkspaceHandlers {
  const { workspaceDir, rootStore, countSkills } = opts;

  function send(res: ServerResponse, ws: WorkspaceConfig, status = 200): void {
    sendJson(res, ws, status);
  }

  function sendError(res: ServerResponse, status: number, message: string): void {
    sendJson(res, { ok: false, error: message }, status);
  }

  return {
    async getWorkspace(_req, res) {
      const ws = loadWorkspace(workspaceDir);
      send(res, ws);
    },

    async postProject(req, res) {
      let body: { path?: unknown; name?: unknown };
      try {
        body = (await readBody(req)) as typeof body;
      } catch {
        return sendError(res, 400, "Malformed JSON body");
      }
      if (typeof body.path !== "string" || body.path.length === 0) {
        return sendError(res, 400, "Missing required field: path");
      }
      const ws = loadWorkspace(workspaceDir);
      try {
        const next = addProject(workspaceDir, ws, {
          path: body.path,
          name: typeof body.name === "string" ? body.name : undefined,
        });
        send(res, next, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/duplicate|already/i.test(message)) return sendError(res, 409, message);
        if (/does not exist|not found/i.test(message)) return sendError(res, 400, message);
        return sendError(res, 400, message);
      }
    },

    async deleteProject(_req, res, params) {
      const id = params.id;
      if (!id) return sendError(res, 400, "Missing id");
      const ws = loadWorkspace(workspaceDir);
      try {
        const next = removeProject(workspaceDir, ws, id);
        send(res, next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|unknown/i.test(message)) return sendError(res, 404, message);
        return sendError(res, 400, message);
      }
    },

    async postActive(req, res) {
      let body: { id?: unknown };
      try {
        body = (await readBody(req)) as typeof body;
      } catch {
        return sendError(res, 400, "Malformed JSON body");
      }
      const id = body.id === null ? null : typeof body.id === "string" ? body.id : undefined;
      if (id === undefined) {
        return sendError(res, 400, "Field 'id' must be a string or null");
      }
      const ws = loadWorkspace(workspaceDir);

      // 0863: switching to a real project with a live rootStore re-roots the
      // running server. Guard the path BEFORE persisting so a bad path never
      // becomes the active project and the old root keeps being served.
      if (id !== null && rootStore) {
        const project = ws.projects.find((p) => p.id === id);
        if (!project) return sendError(res, 404, `Project id not found: ${id}`);

        let usable = false;
        try {
          usable = statSync(project.path).isDirectory();
        } catch {
          usable = false;
        }
        if (!usable) {
          return sendJson(
            res,
            {
              ok: false,
              error: `Project path is not accessible: ${project.path}`,
              fallbackCommand: `cd "${project.path}" && npx vskill@latest studio`,
            },
            409,
          );
        }

        try {
          const next = setActiveProject(workspaceDir, ws, id);
          rootStore.setRoot(project.path);

          let skillCount: number | undefined;
          if (countSkills) {
            try {
              skillCount = await countSkills(project.path);
            } catch {
              skillCount = undefined;
            }
          }
          return sendJson(res, { ok: true, ...next, root: project.path, skillCount }, 200);
        } catch (err) {
          // Mirror the legacy branch's error mapping so a persistence failure
          // returns a consistent envelope instead of a bare 500.
          const message = err instanceof Error ? err.message : String(err);
          if (/not found|unknown/i.test(message)) return sendError(res, 404, message);
          return sendError(res, 400, message);
        }
      }

      // Legacy path: clearing the active project (id === null) or persistence-only
      // contexts (no rootStore, e.g. unit tests) keep the original response shape.
      try {
        const next = setActiveProject(workspaceDir, ws, id);
        send(res, next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|unknown/i.test(message)) return sendError(res, 404, message);
        return sendError(res, 400, message);
      }
    },
  };
}

export function registerWorkspaceRoutes(router: Router, opts: WorkspaceRoutesOptions): void {
  const h = makeWorkspaceHandlers(opts);
  router.get("/api/workspace", (req, res) => h.getWorkspace(req, res));
  router.post("/api/workspace/projects", (req, res) => h.postProject(req, res));
  router.delete("/api/workspace/projects/:id", (req, res, params) => h.deleteProject(req, res, params));
  router.post("/api/workspace/active", (req, res) => h.postActive(req, res));
}
