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
};

export interface EvalServerOptions {
  port: number;
  root: string;
  projectName?: string;
}

export async function startEvalServer(opts: EvalServerOptions): Promise<http.Server> {
  const router = new Router();
  const { port, root } = opts;

  // Register API routes
  registerRoutes(router, root, opts.projectName);

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
      console.log(`\n  Skill Eval UI: http://localhost:${port}\n`);
      resolve(server);
    });
  });
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
