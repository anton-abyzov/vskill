// ---------------------------------------------------------------------------
// eval-server.ts -- HTTP server for the eval UI
// ---------------------------------------------------------------------------

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "./router.js";
import { sendJson } from "./router.js";
import { registerRoutes } from "./api-routes.js";
import { registerImproveRoutes } from "./improve-routes.js";
import { registerModelCompareRoutes } from "./model-compare-routes.js";
import { registerSkillCreateRoutes } from "./skill-create-routes.js";
import { registerSweepRoutes } from "./sweep-routes.js";
import { registerIntegrationRoutes } from "./integration-routes.js";
import { registerScopeTransferRoutes } from "../studio/routes/index.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { loadWorkspace, addProject } from "./workspace-store.js";
import { homedir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webp": "image/webp",
};

export interface EvalServerOptions {
  port: number;
  /**
   * 0698 T-013: `root` is now optional. When omitted, the active project is
   * derived from `~/.vskill/workspace.json`. When provided (e.g. via CLI
   * `--root`), it continues to work as before — and is auto-seeded into the
   * workspace as the active project if no workspace exists yet.
   */
  root?: string;
  projectName?: string;
  /** Override the workspace config directory (tests). Defaults to ~/.vskill. */
  workspaceDir?: string;
}

export async function startEvalServer(opts: EvalServerOptions): Promise<http.Server> {
  const router = new Router();
  const { port } = opts;
  const workspaceDir =
    opts.workspaceDir ??
    process.env.VSKILL_WORKSPACE_DIR ??
    path.join(homedir(), ".vskill");

  // 0698 T-013: resolve root from (in order): explicit opts.root (CLI --root),
  // or the active project in workspace.json. Legacy code paths that require a
  // non-empty root still get one — when there's no workspace and no --root,
  // we fall back to cwd so the server can boot with a minimal empty state.
  const root = opts.root ?? resolveActiveRoot(workspaceDir) ?? process.cwd();

  // Register workspace endpoints FIRST so legacy routes can consult the store.
  registerWorkspaceRoutes(router, { workspaceDir });

  // If --root was passed but workspace is empty, seed it with that project
  // so CLI parity holds (user sees the same sidebar with multi-project UI).
  if (opts.root) {
    seedWorkspaceFromRoot(workspaceDir, opts.root);
  }

  // Register API routes
  registerRoutes(router, root, opts.projectName);
  registerImproveRoutes(router, root);
  registerModelCompareRoutes(router, root);
  registerSkillCreateRoutes(router, root);
  registerSweepRoutes(router, root);
  registerIntegrationRoutes(router, root);
  registerScopeTransferRoutes(router, root);

  // Static asset directory
  const staticDir = path.resolve(__dirname, "../eval-ui");

  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      const apiRoutes = req.url?.startsWith("/api/");
      if (apiRoutes && (router as any).options) {
        (router as any).options(req, res);
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Try API routes first
    const handled = await router.handle(req, res);
    if (handled) return;

    // 404 for unknown API routes
    if (req.url?.startsWith("/api/")) {
      sendJson(res, { error: "Not found" }, 404, req);
      return;
    }

    // Serve static files
    await serveStatic(req, res, staticDir);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`\n  Skill Studio: http://localhost:${port}\n`);
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------
// 0698 T-013: workspace-aware root resolution + CLI --root seed.
// ---------------------------------------------------------------------------

function resolveActiveRoot(workspaceDir: string): string | null {
  try {
    const ws = loadWorkspace(workspaceDir);
    if (!ws.activeProjectId) return null;
    const active = ws.projects.find((p) => p.id === ws.activeProjectId);
    return active ? active.path : null;
  } catch {
    return null;
  }
}

function seedWorkspaceFromRoot(workspaceDir: string, root: string): void {
  try {
    const ws = loadWorkspace(workspaceDir);
    // Only auto-seed when the workspace is completely empty — otherwise the
    // existing projects are the source of truth and a CLI `--root` flag is
    // treated as a one-off session override (resolveActiveRoot handles that
    // separately by honoring opts.root when present).
    if (ws.projects.length > 0) return;
    addProject(workspaceDir, ws, { path: root });
  } catch {
    /* non-fatal — workspace is optional */
  }
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): Promise<void> {
  let urlPath = new URL(req.url || "/", "http://localhost").pathname;
  if (urlPath === "/") urlPath = "/index.html";

  // Security: prevent path traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(staticDir, safePath);

  // Ensure we stay within staticDir
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  } catch {
    // File not found - SPA fallback
  }

  // SPA fallback: serve index.html for all unmatched routes
  const indexPath = path.join(staticDir, "index.html");
  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found — run 'npm run build:eval-ui' first");
  }
}
