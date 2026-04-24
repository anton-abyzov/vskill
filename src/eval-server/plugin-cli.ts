// ---------------------------------------------------------------------------
// 0700 — Claude Code plugin CLI wrapper (pure parsing + subprocess runners).
//
// Wraps `claude plugin list` / `enable` / `disable` / `install` / `uninstall`
// so the UI can manage plugins without dropping to a terminal.
//
// Design:
//   - Parsing is pure — runClaudePlugin() runs the CLI, returns stdout; the
//     parsers are plain functions so unit tests can feed them fixture output.
//   - All operations are tagged with a `scope` (user/project/local). Parsing
//     preserves it so the UI can show "same plugin installed at two scopes"
//     (the `claude plugin list` output shows this for sw@specweave).
//
// Output shapes (for UI consumption):
//   InstalledPlugin  = { name, marketplace, version, scope, enabled }
//   Marketplace      = { name, source }
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

export type PluginScope = "user" | "project" | "local";

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  scope: PluginScope;
  enabled: boolean;
}

export interface Marketplace {
  name: string;
  source: string;
}

export interface ClaudeCliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a `claude plugin ...` command. Returns captured stdout/stderr/code.
 * Does NOT throw on non-zero exit — callers decide how to interpret failure.
 */
export function runClaudePlugin(
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<ClaudeCliResult> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["plugin", ...args], {
      cwd: opts.cwd,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill("SIGTERM");
        }, opts.timeout)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: 1 });
    });
  });
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse the output of `claude plugin list`. Expected block shape per plugin:
 *
 *   ❯ <name>@<marketplace>
 *     Version: <semver>
 *     Scope: <user|project|local>
 *     Status: <check> enabled   |   <x> disabled
 *
 * Returns [] when the output has no plugins (e.g., "No installed plugins.").
 */
export function parseInstalledPlugins(stdout: string): InstalledPlugin[] {
  const plugins: InstalledPlugin[] = [];
  const lines = stdout.split(/\r?\n/);
  let current: Partial<InstalledPlugin> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    // Header line e.g. "❯ codex@openai-codex" (leading glyph may vary — we
    // accept any non-word char before the name).
    const header = line.match(/^[^\w\s]+\s+([a-z0-9][\w-]*)@([a-z0-9][\w-]*)\s*$/i);
    if (header) {
      if (current && current.name) {
        plugins.push(finalizePlugin(current));
      }
      current = { name: header[1], marketplace: header[2] };
      continue;
    }
    if (!current) continue;
    const version = line.match(/^Version:\s*(.+)$/i);
    if (version) {
      current.version = version[1].trim();
      continue;
    }
    const scope = line.match(/^Scope:\s*(user|project|local)\s*$/i);
    if (scope) {
      current.scope = scope[1].toLowerCase() as PluginScope;
      continue;
    }
    const status = line.match(/^Status:\s*(.+)$/i);
    if (status) {
      current.enabled = /enabled/i.test(status[1]) && !/disabled/i.test(status[1]);
      continue;
    }
  }
  if (current && current.name) {
    plugins.push(finalizePlugin(current));
  }
  return plugins;
}

function finalizePlugin(p: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    name: p.name ?? "",
    marketplace: p.marketplace ?? "",
    version: p.version ?? "",
    scope: (p.scope ?? "user") as PluginScope,
    enabled: p.enabled ?? false,
  };
}

/**
 * Parse the output of `claude plugin marketplace list`. Expected per entry:
 *
 *   ❯ <name>
 *     Source: <kind> (<detail>)
 */
export function parseMarketplaces(stdout: string): Marketplace[] {
  const out: Marketplace[] = [];
  const lines = stdout.split(/\r?\n/);
  let current: Partial<Marketplace> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const header = line.match(/^[^\w\s]+\s+([a-z0-9][\w./:-]*)\s*$/i);
    if (header && !line.startsWith("Source:")) {
      if (current && current.name) {
        out.push({ name: current.name, source: current.source ?? "" });
      }
      current = { name: header[1] };
      continue;
    }
    if (!current) continue;
    const source = line.match(/^Source:\s*(.+)$/i);
    if (source) {
      current.source = source[1].trim();
      continue;
    }
  }
  if (current && current.name) {
    out.push({ name: current.name, source: current.source ?? "" });
  }
  return out;
}
