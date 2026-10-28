// ---------------------------------------------------------------------------
// vskill-cli-runner.ts -- run the vskill CLI that ships with this Studio.
//
// 1126 P1-5: Studio used to run whatever `vskill` was first on PATH through a
// blocking execFileSync. A Studio built from 1.2.15 then updated skills with
// a 1.2.11 CLI (or failed with ENOENT when none was installed), and every
// call froze the server for up to 60 s. This module:
//
//   - runs this package's own `dist/index.js` with the current Node binary
//     (process.execPath), resolved relative to this module, so the CLI and the
//     server are always the same version;
//   - falls back to `vskill` on PATH when that entry is absent (desktop SEA
//     sidecar, source checkout under tsx/vitest);
//   - spawns asynchronously with an argv array (never a shell), a timeout and
//     capped output buffers.
//
// classifyUpdateRun() turns a `vskill update` run into a truthful result: the
// CLI exits 0 for pinned skips, "already up to date", and several failure
// lines, so the exit code alone cannot be trusted.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { enhancedSpawnEnv } from "../utils/resolve-binary.js";

export interface VskillInvocation {
  command: string;
  prefixArgs: string[];
  /** True when the bundled CLI next to this server is used. */
  bundled: boolean;
}

export interface VskillRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn failure message (ENOENT and friends). */
  spawnError?: string;
  bundled: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const MAX_OUTPUT = 64 * 1024;

function isSeaBinary(): boolean {
  try {
    const req = createRequire(import.meta.url);
    const sea = req("node:sea") as { isSea?: () => boolean };
    return typeof sea.isSea === "function" && sea.isSea();
  } catch {
    return false;
  }
}

/**
 * Path of this package's CLI entry (`dist/index.js`) when it exists next to
 * the compiled server (`dist/eval-server/vskill-cli-runner.js`), else null.
 * `moduleUrl` is a test seam.
 */
export function resolveBundledCliEntry(moduleUrl: string = import.meta.url): string | null {
  try {
    if (!moduleUrl) return null;
    const here = dirname(fileURLToPath(moduleUrl));
    const entry = join(here, "..", "index.js");
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

let cachedInvocation: VskillInvocation | null = null;

export function resolveVskillInvocation(): VskillInvocation {
  if (cachedInvocation) return cachedInvocation;
  // In the desktop SEA sidecar process.execPath is the sidecar itself, so
  // running it with a script path would start a second server, not the CLI.
  const entry = isSeaBinary() ? null : resolveBundledCliEntry();
  cachedInvocation = entry
    ? { command: process.execPath, prefixArgs: [entry], bundled: true }
    : { command: "vskill", prefixArgs: [], bundled: false };
  return cachedInvocation;
}

/** Test-only: forget the resolved invocation. */
export function resetVskillInvocationForTests(): void {
  cachedInvocation = null;
}

/**
 * Spawn `command args` without a shell and collect its output. Never rejects:
 * spawn errors and timeouts are reported on the result.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: RunOptions & { bundled?: boolean },
): Promise<VskillRunResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (r: Omit<VskillRunResult, "stdout" | "stderr" | "bundled">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ...r, stdout, stderr, bundled: opts.bundled ?? false });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: {
          ...(opts.env ?? enhancedSpawnEnv()),
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          CI: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      resolvePromise({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: (err as Error).message,
        bundled: opts.bundled ?? false,
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf-8");
    });
    child.on("error", (err) => finish({ code: null, timedOut, spawnError: err.message }));
    child.on("close", (code) => finish({ code, timedOut }));
  });
}

/** Run the vskill CLI (bundled first, PATH fallback) with `args`. */
export function runVskill(args: string[], opts: RunOptions): Promise<VskillRunResult> {
  const inv = resolveVskillInvocation();
  return runCommand(inv.command, [...inv.prefixArgs, ...args], { ...opts, bundled: inv.bundled });
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Last non-empty line of `text`, trimmed and capped. */
export function lastLine(text: string, max = 300): string {
  const lines = stripAnsi(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines[lines.length - 1] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export type UpdateRunStatus = "done" | "skipped" | "error";

export interface UpdateRunOutcome {
  status: UpdateRunStatus;
  /** For skipped: why. For done: "up-to-date" when nothing changed. */
  reason?: "pinned" | "plugin" | "not-on-disk" | "up-to-date";
  pinnedVersion?: string;
  /** Human-readable message for error and skipped results. */
  message?: string;
  /** Version parsed from a `name: a -> b` line, when present. */
  toVersion?: string;
}

const ERROR_LINE_RES: RegExp[] = [
  /Refusing to update [^\n]+/,
  /could not fetch update from any source/,
  /could not write the update \([^\n]*\)/,
  /update failed \([^\n]*\)/,
  /Private update failed[^\n]*/,
  /Skill "[^"]+" is not installed\./,
  /No (?:user-level )?vskill\.lock found[^\n]*/,
  /No agents detected\. Cannot update\./,
  /No skills installed\. Nothing to update\./,
];

/**
 * Classify one `vskill update <name>` run. Exit 0 is not success: the CLI
 * prints pinned skips, scan refusals and fetch failures and still exits 0.
 */
export function classifyUpdateRun(run: VskillRunResult): UpdateRunOutcome {
  if (run.spawnError) {
    const notFound = /ENOENT/.test(run.spawnError);
    return {
      status: "error",
      message: notFound
        ? "The vskill CLI was not found: Studio has no bundled CLI and none is on PATH."
        : `Could not start vskill: ${run.spawnError}`,
    };
  }
  if (run.timedOut) {
    return { status: "error", message: "vskill update timed out." };
  }
  const out = stripAnsi(`${run.stdout}\n${run.stderr}`);

  const pinned = out.match(/pinned at (\S+) — skipping/);
  if (pinned) {
    return {
      status: "skipped",
      reason: "pinned",
      pinnedVersion: pinned[1],
      message: `Pinned at ${pinned[1]}; unpin it to update.`,
    };
  }
  if (/: plugin — update it with/.test(out)) {
    const line = out.split(/\r?\n/).find((l) => l.includes("plugin — update it with"))?.trim();
    return { status: "skipped", reason: "plugin", message: line ?? "Installed by a plugin; update the plugin." };
  }
  if (/not on disk — skipping/.test(out)) {
    return {
      status: "skipped",
      reason: "not-on-disk",
      message: "In vskill.lock but not on disk; reinstall it.",
    };
  }
  for (const re of ERROR_LINE_RES) {
    const m = out.match(re);
    if (m) return { status: "error", message: m[0].trim() };
  }
  if (run.code !== 0) {
    const detail = lastLine(run.stderr) || lastLine(run.stdout) || `exit code ${run.code}`;
    return { status: "error", message: detail };
  }
  const arrow = out.match(/->\s*v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/);
  if (/already up to date/.test(out) && !arrow) {
    return { status: "done", reason: "up-to-date" };
  }
  return { status: "done", ...(arrow ? { toVersion: arrow[1] } : {}) };
}
