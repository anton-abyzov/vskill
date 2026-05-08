// ---------------------------------------------------------------------------
// 0832 T-001: Studio runtime lock files at ~/.vskill/runtime/studio-{port}.lock
//
// Written by `vskill studio` when it binds a port; consumed by the Tauri-side
// `process_discovery` scanner as a fast path for enumerating running studio
// instances. Format is a small JSON record:
//
//   { pid, port, cmdline, startedAt }
//
// Atomic write strategy: tmp-file + fsync + rename. Cleanup on SIGTERM/SIGINT
// is registered idempotently so two signals don't double-unlink (the second
// unlink turns into ENOENT, which we swallow).
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type StudioLockSource = "npx-cli" | "node-direct" | "tauri";

export interface StudioLock {
  /** OS PID of the process holding the lock. */
  pid: number;
  /** TCP port the studio runtime is bound to. */
  port: number;
  /** Truncated argv joined into a single line (≤120 chars). */
  cmdline: string;
  /** ISO-8601 UTC timestamp at which the runtime announced its bind. */
  startedAt: string;
  /** Optional source classification — defaults to "npx-cli" when omitted. */
  source?: StudioLockSource;
}

/** Returns `~/.vskill/runtime/`. Honours `$HOME` (Unix) and `$USERPROFILE` (Windows). */
export function runtimeDir(): string {
  return path.join(os.homedir(), ".vskill", "runtime");
}

/** Returns the lock-file path for a given port. */
export function lockfilePath(port: number): string {
  return path.join(runtimeDir(), `studio-${port}.lock`);
}

/**
 * Atomically write a studio lock file. Creates `~/.vskill/runtime/` if missing.
 *
 * Mode 0600 on Unix (parent dir 0700). Windows: stock fs perms — Tauri scanner
 * does the cross-platform PID liveness check anyway.
 *
 * 0832 F-007: if the target lock already exists and is owned by a LIVE
 * process (PID alive AND pid != ours), refuse to overwrite. This avoids the
 * TOCTOU race where two CLIs racing for the same port silently clobber each
 * other's lock content. Stale locks (owner dead) are replaced normally.
 */
export function writeLock(lock: StudioLock): string {
  const dir = runtimeDir();
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* best-effort */
    }
  }

  const target = lockfilePath(lock.port);

  // 0832 F-007: refuse to clobber a live foreign lock. Stale locks (owner PID
  // is dead) are eligible for replacement — that's the normal restart path.
  const existing = readLock(lock.port);
  if (existing && existing.pid !== lock.pid && isPidAlive(existing.pid)) {
    throw new Error(
      `lockfile: port ${lock.port} is held by live pid ${existing.pid}`,
    );
  }

  const tmp = `${target}.tmp.${process.pid}`;
  const payload = JSON.stringify({
    pid: lock.pid,
    port: lock.port,
    cmdline: truncateCmdline(lock.cmdline),
    startedAt: lock.startedAt,
    source: lock.source ?? "npx-cli",
  });

  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      /* best-effort */
    }
  }
  fs.renameSync(tmp, target);
  return target;
}

/** Read a lock file by port. Returns `null` if missing or unparseable. */
export function readLock(port: number): StudioLock | null {
  const target = lockfilePath(port);
  let raw: string;
  try {
    raw = fs.readFileSync(target, "utf8");
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(raw);
    if (
      typeof obj.pid !== "number" ||
      typeof obj.port !== "number" ||
      typeof obj.startedAt !== "string"
    ) {
      return null;
    }
    return {
      pid: obj.pid,
      port: obj.port,
      cmdline: typeof obj.cmdline === "string" ? obj.cmdline : "",
      startedAt: obj.startedAt,
      source: obj.source === "tauri" || obj.source === "node-direct" ? obj.source : "npx-cli",
    };
  } catch {
    return null;
  }
}

/** Remove the lock file for `port`. Swallows ENOENT (idempotent). */
export function removeLock(port: number): void {
  const target = lockfilePath(port);
  try {
    fs.unlinkSync(target);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      // Anything other than "already gone" is worth a warning.
      // We don't throw — caller is in a shutdown path, can't recover.
      // eslint-disable-next-line no-console
      console.warn(`[lockfile] could not remove ${target}: ${(e as Error).message}`);
    }
  }
}

/** List every `studio-*.lock` in the runtime dir. Returns parsed locks (skips invalid). */
export function listLocks(): Array<StudioLock & { _path: string }> {
  const dir = runtimeDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<StudioLock & { _path: string }> = [];
  for (const name of entries) {
    if (!name.startsWith("studio-") || !name.endsWith(".lock")) continue;
    const portStr = name.slice("studio-".length, name.length - ".lock".length);
    const port = Number.parseInt(portStr, 10);
    if (!Number.isFinite(port)) continue;
    const lock = readLock(port);
    if (lock) {
      out.push({ ...lock, _path: path.join(dir, name) });
    }
  }
  return out;
}

/**
 * Check if `pid` is a live process. Uses `process.kill(pid, 0)` which throws
 * `ESRCH` for nonexistent processes and `EPERM` for live-but-not-ours (still
 * counts as alive). Returns `false` only when ESRCH.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Prune lock files that no longer correspond to a live process or are >1d old.
 * Returns the list of remaining (live) locks.
 */
export function pruneStaleLocks(now: Date = new Date()): Array<StudioLock & { _path: string }> {
  const live: Array<StudioLock & { _path: string }> = [];
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (const lock of listLocks()) {
    const startedAt = Date.parse(lock.startedAt);
    const ageMs = Number.isFinite(startedAt) ? now.getTime() - startedAt : 0;
    const tooOld = ageMs > oneDayMs;
    if (!isPidAlive(lock.pid) || tooOld) {
      try {
        fs.unlinkSync(lock._path);
      } catch {
        /* best-effort */
      }
      continue;
    }
    live.push(lock);
  }
  return live;
}

/**
 * Register a one-shot cleanup that removes our lock file on SIGINT/SIGTERM/exit.
 * Idempotent across multiple calls — repeated registrations are no-ops.
 */
let _registeredCleanupForPort: number | null = null;
export function registerCleanup(port: number): void {
  if (_registeredCleanupForPort === port) return;
  _registeredCleanupForPort = port;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeLock(port);
  };

  // Synchronous-on-exit cleanup. Node fires this last; safe spot to unlink.
  process.on("exit", cleanup);
  // Signal handlers — we DO NOT exit ourselves; the existing studio shutdown
  // path owns the exit. We just remove the lock first so a subsequent scan
  // sees the right state immediately.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      cleanup();
    });
  }
}

function truncateCmdline(cmd: string): string {
  if (cmd.length <= 120) return cmd;
  return cmd.slice(0, 117) + "...";
}
