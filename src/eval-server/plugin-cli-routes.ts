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
// CLI exit-code semantics:
//   - exit 0           → 200 { ok: true, ..., plugins }
//   - exit non-zero    → 200 { ok: false, code: "claude-cli-failed", error, stderr }
//                        (CLI ran fine, the *operation* failed — UI surfaces error)
//   - thrown exception → 500 { ok: false, code: "unexpected", error }
//
// The refreshed plugin list is returned inline on every successful mutation
// so the UI doesn't need a second GET.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import {
  runClaudePlugin,
  parseInstalledPlugins,
  parseMarketplaces,
  type PluginScope,
  type InstalledPlugin,
} from "./plugin-cli.js";
import { buildClaudeCliFailureResponse } from "./plugin-cli-response.js";
import { resolvePluginRef } from "./plugin-ref-resolver.js";

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

  // GET /api/plugins/marketplaces/:name — read the cached marketplace.json
  // for a specific marketplace and return its catalog of available plugins.
  // (0700 phase 2B: powers the Marketplace browser drawer.)
  router.get("/api/plugins/marketplaces/:name", (_req, res, params) => {
    const name = params.name;
    if (!/^[a-z0-9][\w.-]*$/i.test(name)) {
      return sendError(res, 400, "invalid-name", `Invalid marketplace name: ${name}`);
    }
    const cachePath = join(
      homedir(),
      ".claude",
      "plugins",
      "marketplaces",
      name,
      ".claude-plugin",
      "marketplace.json",
    );
    if (!existsSync(cachePath)) {
      return sendError(res, 404, "not-found", `Marketplace '${name}' not cached locally`);
    }
    try {
      const raw = readFileSync(cachePath, "utf8");
      const data = JSON.parse(raw) as {
        name?: string;
        description?: string;
        plugins?: Array<{
          name?: string;
          description?: string;
          version?: string;
          category?: string;
          author?: { name?: string };
        }>;
      };
      const plugins = (data.plugins ?? []).map((p) => ({
        name: p.name ?? "unknown",
        description: p.description ?? "",
        version: p.version ?? "",
        category: p.category ?? "",
        author: p.author?.name ?? "",
      }));
      sendJson(res, {
        name: data.name ?? name,
        description: data.description ?? "",
        plugins,
      });
    } catch (err) {
      sendError(res, 500, "parse-failed", err instanceof Error ? err.message : String(err));
    }
  });

  // POST /api/plugins/install/stream — SSE-streaming install. Sends incremental
  // `data: {"line": "..."}` events as stdout arrives, then `data: {"done": true, "ok": <bool>, "code": <n>}`.
  // (0700 phase 2C: powers the progress toast/drawer during slow network ops.)
  router.post("/api/plugins/install/stream", async (req, res) => {
    const body = await safeReadBody(req);
    const plugin = typeof body.plugin === "string" ? body.plugin : "";
    if (!PLUGIN_REF.test(plugin)) {
      return sendError(res, 400, "invalid-plugin-ref", `Invalid plugin reference: ${plugin}`);
    }
    const scope = body.scope;
    if (scope !== undefined && !isValidScope(scope)) {
      return sendError(res, 400, "invalid-scope", `Invalid scope: ${scope}`);
    }
    // SSE setup
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    function send(event: object): void {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const args = ["plugin", "install", plugin, ...(scope ? ["--scope", scope] : [])];
    const child = spawn("claude", args, { cwd: root, env: process.env });

    send({ type: "start", plugin, scope: scope ?? "user" });

    function streamLines(chunk: Buffer, kind: "stdout" | "stderr"): void {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) send({ type: kind, line });
      }
    }

    child.stdout.on("data", (chunk) => streamLines(chunk, "stdout"));
    child.stderr.on("data", (chunk) => streamLines(chunk, "stderr"));
    child.on("close", (code) => {
      send({ type: "done", ok: code === 0, code });
      res.end();
    });
    child.on("error", (err) => {
      send({ type: "error", error: err.message });
      res.end();
    });

    // Kill if client disconnects
    req.on("close", () => {
      if (!child.killed) child.kill("SIGTERM");
    });
  });

  // POST /api/plugins/marketplaces — add a marketplace (owner/repo, URL, or path)
  router.post("/api/plugins/marketplaces", async (req, res) => {
    const body = await safeReadBody(req);
    const source = typeof body.source === "string" ? body.source.trim() : "";
    if (!source) {
      return sendError(res, 400, "invalid-source", "source is required");
    }
    // Permissive validation — `claude plugin marketplace add` accepts
    // owner/repo, URLs, and filesystem paths. Reject only obviously dangerous
    // shell metacharacters.
    if (/[\s;&|`$(){}[\]<>]/.test(source)) {
      return sendError(res, 400, "invalid-source", "source contains forbidden characters");
    }
    const result = await runClaudePlugin(["marketplace", "add", source], {
      cwd: root,
      timeout: 30_000,
    });
    if (result.code !== 0) {
      return sendJson(
        res,
        {
          ok: false,
          code: "claude-cli-failed",
          error: result.stderr.trim() || result.stdout.trim() || "add failed",
        },
        500,
      );
    }
    sendJson(res, { ok: true, stdout: result.stdout });
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
    const ref = resolvePluginRef(name, await fetchPluginList(root));
    const args = ["enable", ref, ...(scope ? ["--scope", scope] : [])];
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
    const ref = resolvePluginRef(name, await fetchPluginList(root));
    const args = ["disable", ref, ...(scope ? ["--scope", scope] : [])];
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
    // 0743: Claude requires `name@marketplace` for plugins from a marketplace
    // (bare name returns "not found in installed plugins"). Resolve the bare
    // name against the installed-list output so the UI can keep using the
    // short name while we shell out with the right ref.
    const ref = resolvePluginRef(name, await fetchPluginList(root));
    const args = ["uninstall", ref, ...(scope ? ["--scope", scope] : [])];
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
      const { status, body } = buildClaudeCliFailureResponse(result);
      sendJson(res, body, status);
      return;
    }
    // Re-fetch the plugin list so the UI can refresh without a second call.
    const plugins = await fetchPluginList(cwd);
    sendJson(res, { ok: true, stdout: result.stdout, plugins });
  } catch (err) {
    sendError(res, 500, "unexpected", err instanceof Error ? err.message : String(err));
  }
}
