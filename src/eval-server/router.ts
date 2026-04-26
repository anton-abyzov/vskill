// ---------------------------------------------------------------------------
// router.ts -- minimal HTTP router adapted from specweave dashboard pattern
// ---------------------------------------------------------------------------

import * as http from "node:http";

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
) => Promise<void> | void;

export class Router {
  private routes: Route[] = [];
  options?: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler);
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const pattern = path.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
    });
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      try {
        await route.handler(req, res, params);
      } catch (err) {
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : "Internal server error";
          const sanitized = message.replace(/\/[^\s:]+/g, "<path>");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: sanitized }));
        }
      }
      return true;
    }
    return false;
  }
}

/** Matches any localhost/loopback Origin value (http or https, any port). */
export const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status = 200,
  req?: http.IncomingMessage,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const origin = req?.headers?.origin;
  if (origin && LOCALHOST_ORIGIN_RE.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

export async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const MAX_BODY_SIZE = 1024 * 1024;
  const TIMEOUT_MS = 10_000;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("Request body timeout"));
    }, TIMEOUT_MS);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString();
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
