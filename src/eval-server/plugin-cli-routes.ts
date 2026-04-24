// ---------------------------------------------------------------------------
// 0700 — Plugin CLI REST endpoints.
//
// Wraps `claude plugin ...` subcommands behind JSON HTTP. The UI uses these
// to surface Enable/Disable/Uninstall/Install actions per plugin without
// making the user drop to a terminal.
//
//   GET    /api/plugins                     → { plugins: InstalledPlugin[] }
//   GET    /api/plugins/marketplaces        → { marketplaces: Marketplace[] }
//   POST   /api/plugins/:name/enable        body: { scope? } → { ok, plugins }
//   POST   /api/plugins/:name/disable       body: { scope? } → { ok, plugins }
//   POST   /api/plugins/install             body: { plugin, scope? } → { ok, stdout, plugins }
//   POST   /api/plugins/:name/uninstall     body: { scope? } → { ok, stdout, plugins }
//
// Any non-2xx exit from `claude` is surfaced as 500 with the stderr trail.
// The refreshed plugin list is returned inline on every mutation so the UI
// doesn't need a second GET.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import {
  runClaudePlugin,
  parseInstalledPlugins,
  parseMarketplaces,
  type PluginScope,
  type InstalledPlugin,
} from "./plugin-cli.js";

const VALID_SCOPES: readonly PluginScope[] = ["user", "project", "local"] as const;

function isValidScope(s: unknown): s is PluginScope {
  return typeof s === "string" && (VALID_SCOPES as readonly string[]).includes(s);
}

// Plugin-name validation — matches what `claude` accepts: alphanumerics +
// hyphens + optional `@marketplace` suffix.
const PLUGIN_REF = /^[a-z0-9][\w.-]*(?:@[a-z0-9][\w.-]*)?$/i;

function sendError(res: ServerResponse, status: number, code: string, msg: string): void {
  sendJson(res, { ok: false, code, error: msg }, status);
}

async function fetchPluginList(cwd?: string): Promise<InstalledPlugin[]> {
  const result = await runClaudePlugin(["list"], { cwd, timeout: 15_000 });
  if (result.code !== 0) return [];
  return parseInstalledPlugins(result.stdout);
}

export function registerPluginCliRoutes(router: Router, root: string): void {
  // GET /api/plugins — list installed plugins
  router.get("/api/plugins", async (_req, res) => {
    try {
      const result = await runClaudePlugin(["list"], { cwd: root, timeout: 15_000 });
      if (result.code !== 0) {
        return sendError(res, 500, "claude-cli-failed", result.stderr.trim() || "claude plugin list failed");
      }
      const plugins = parseInstalledPlugins(result.stdout);
      sendJson(res, { plugins });
    } catch (err) {
      sendError(res, 500, "unexpected", err instanceof Error ? err.message : String(err));
    }
  });

  // GET /api/plugins/marketplaces — list configured marketplaces
  router.get("/api/plugins/marketplaces", async (_req, res) => {
    try {
      const result = await runClaudePlugin(["marketplace", "list"], { cwd: root, timeout: 15_000 });
      if (result.code !== 0) {
        return sendError(res, 500, "claude-cli-failed", result.stderr.trim() || "claude plugin marketplace list failed");
      }
      const marketplaces = parseMarketplaces(result.stdout);
      sendJson(res, { marketplaces });
    } catch (err) {
      sendError(res, 500, "unexpected", err instanceof Error ? err.message : String(err));
    }
  });

  // POST /api/plugins/:name/enable
  router.post("/api/plugins/:name/enable", async (req, res, params) => {
    const name = params.name;
    if (!PLUGIN_REF.test(name)) {
      return sendError(res, 400, "invalid-plugin-name", `Invalid plugin name: ${name}`);
    }
    const body = await safeReadBody(req);
    const scope = body.scope;
    if (scope !== undefined && !isValidScope(scope)) {
      return sendError(res, 400, "invalid-scope", `Invalid scope: ${scope}`);
    }
    const args = ["enable", name, ...(scope ? ["--scope", scope] : [])];
    await runAndRespond(args, root, res);
  });

  // POST /api/plugins/:name/disable
  router.post("/api/plugins/:name/disable", async (req, res, params) => {
    const name = params.name;
    if (!PLUGIN_REF.test(name)) {
      return sendError(res, 400, "invalid-plugin-name", `Invalid plugin name: ${name}`);
    }
    const body = await safeReadBody(req);
    const scope = body.scope;
    if (scope !== undefined && !isValidScope(scope)) {
      return sendError(res, 400, "invalid-scope", `Invalid scope: ${scope}`);
    }
    const args = ["disable", name, ...(scope ? ["--scope", scope] : [])];
    await runAndRespond(args, root, res);
  });

  // POST /api/plugins/install body { plugin: "name@marketplace", scope? }
  router.post("/api/plugins/install", async (req, res) => {
    const body = await safeReadBody(req);
    const plugin = typeof body.plugin === "string" ? body.plugin : "";
    if (!PLUGIN_REF.test(plugin)) {
      return sendError(res, 400, "invalid-plugin-ref", `Invalid plugin reference: ${plugin}`);
    }
    const scope = body.scope;
    if (scope !== undefined && !isValidScope(scope)) {
      return sendError(res, 400, "invalid-scope", `Invalid scope: ${scope}`);
    }
    const args = ["install", plugin, ...(scope ? ["--scope", scope] : [])];
    await runAndRespond(args, root, res, { timeout: 60_000 });
  });

  // POST /api/plugins/:name/uninstall
  router.post("/api/plugins/:name/uninstall", async (req, res, params) => {
    const name = params.name;
    if (!PLUGIN_REF.test(name)) {
      return sendError(res, 400, "invalid-plugin-name", `Invalid plugin name: ${name}`);
    }
    const body = await safeReadBody(req);
    const scope = body.scope;
    if (scope !== undefined && !isValidScope(scope)) {
      return sendError(res, 400, "invalid-scope", `Invalid scope: ${scope}`);
    }
    // The official CLI exposes `uninstall` as a subcommand — if it evolves or
    // isn't present on an older `claude` binary, the spawn will surface a
    // non-zero exit and the UI will see `code: "claude-cli-failed"`.
    const args = ["uninstall", name, ...(scope ? ["--scope", scope] : [])];
    await runAndRespond(args, root, res, { timeout: 30_000 });
  });
}

async function safeReadBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const body = await readBody(req);
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function runAndRespond(
  args: string[],
  cwd: string,
  res: ServerResponse,
  opts: { timeout?: number } = {},
): Promise<void> {
  try {
    const result = await runClaudePlugin(args, { cwd, timeout: opts.timeout ?? 20_000 });
    if (result.code !== 0) {
      sendJson(
        res,
        {
          ok: false,
          code: "claude-cli-failed",
          error: result.stderr.trim() || result.stdout.trim() || "claude plugin command failed",
          stdout: result.stdout,
          stderr: result.stderr,
        },
        500,
      );
      return;
    }
    // Re-fetch the plugin list so the UI can refresh without a second call.
    const plugins = await fetchPluginList(cwd);
    sendJson(res, { ok: true, stdout: result.stdout, plugins });
  } catch (err) {
    sendError(res, 500, "unexpected", err instanceof Error ? err.message : String(err));
  }
}
