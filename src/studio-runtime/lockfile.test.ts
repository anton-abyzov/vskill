// 0832 T-001/T-006: studio runtime lock-file unit tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  isPidAlive,
  listLocks,
  lockfilePath,
  pruneStaleLocks,
  readLock,
  registerCleanup,
  removeLock,
  runtimeDir,
  writeLock,
} from "./lockfile.js";

// Each test gets its own fake $HOME so we don't trample real ~/.vskill state.
let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-lockfile-test-"));
  process.env.HOME = tmpHome;
  // os.homedir() caches on some platforms — invalidate by reassigning HOME
  // and re-importing... but vitest hot-resolves env on access in our impl.
});

afterEach(() => {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("studio-runtime/lockfile — write + roundtrip", () => {
  it("writes the lock file at ~/.vskill/runtime/studio-{port}.lock", () => {
    const target = writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "node /usr/local/bin/vskill studio --port 7077",
      startedAt: "2026-05-07T12:00:00.000Z",
      source: "npx-cli",
    });
    expect(target).toBe(path.join(tmpHome, ".vskill", "runtime", "studio-7077.lock"));
    expect(fs.existsSync(target)).toBe(true);
  });

  it("readLock roundtrips every persisted field", () => {
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "node /usr/local/bin/vskill studio --port 7077",
      startedAt: "2026-05-07T12:00:00.000Z",
      source: "npx-cli",
    });
    const lock = readLock(7077);
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(4321);
    expect(lock!.port).toBe(7077);
    expect(lock!.cmdline).toContain("vskill studio --port 7077");
    expect(lock!.startedAt).toBe("2026-05-07T12:00:00.000Z");
    expect(lock!.source).toBe("npx-cli");
  });

  it("readLock returns null for a missing file", () => {
    expect(readLock(9999)).toBeNull();
  });

  it("readLock returns null for malformed JSON", () => {
    fs.mkdirSync(runtimeDir(), { recursive: true });
    fs.writeFileSync(lockfilePath(8080), "not json {{{", { mode: 0o600 });
    expect(readLock(8080)).toBeNull();
  });

  it("truncates very long cmdline to 120 chars", () => {
    const longCmd = "node /path/to/vskill " + "x".repeat(500);
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: longCmd,
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    const lock = readLock(7077);
    expect(lock!.cmdline.length).toBeLessThanOrEqual(120);
    expect(lock!.cmdline.endsWith("...")).toBe(true);
  });

  it("write is atomic — tmp file is gone after success", () => {
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "x",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    const dir = runtimeDir();
    const tmps = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("studio-7077.lock.tmp."));
    expect(tmps).toEqual([]);
  });

  it("Unix: lock file written with mode 0600", () => {
    if (process.platform === "win32") return;
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "x",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    const mode = fs.statSync(lockfilePath(7077)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("0832 F-007: refuses to clobber a lock held by a live foreign pid", () => {
    // Seed an existing lock owned by THIS process pid (definitely alive).
    writeLock({
      pid: process.pid,
      port: 7077,
      cmdline: "first",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    // A different process trying to write the same port must throw.
    expect(() =>
      writeLock({
        pid: process.pid + 999_999, // simulate "different writer"
        port: 7077,
        cmdline: "second",
        startedAt: "2026-05-07T12:00:01.000Z",
      }),
    ).toThrow(/held by live pid/);
    // Original lock is untouched.
    const cur = readLock(7077);
    expect(cur).not.toBeNull();
    expect(cur!.cmdline).toBe("first");
  });

  it("0832 F-007: replaces a stale lock whose owner pid is dead", () => {
    // Seed a lock owned by a definitely-dead pid (chosen to avoid live PIDs).
    const deadPid = 999_999;
    writeLock({
      pid: deadPid,
      port: 7079,
      cmdline: "stale",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    // We can replace it because the owner is dead.
    expect(() =>
      writeLock({
        pid: process.pid,
        port: 7079,
        cmdline: "fresh",
        startedAt: "2026-05-07T12:00:01.000Z",
      }),
    ).not.toThrow();
    const cur = readLock(7079);
    expect(cur!.cmdline).toBe("fresh");
    expect(cur!.pid).toBe(process.pid);
  });

  it("0832 F-007: same-pid rewrite (e.g., heartbeat refresh) is allowed", () => {
    writeLock({
      pid: process.pid,
      port: 7080,
      cmdline: "first",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    expect(() =>
      writeLock({
        pid: process.pid,
        port: 7080,
        cmdline: "refreshed",
        startedAt: "2026-05-07T12:00:01.000Z",
      }),
    ).not.toThrow();
    expect(readLock(7080)!.cmdline).toBe("refreshed");
  });
});

describe("studio-runtime/lockfile — removeLock", () => {
  it("removes the lock file", () => {
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "x",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    expect(fs.existsSync(lockfilePath(7077))).toBe(true);
    removeLock(7077);
    expect(fs.existsSync(lockfilePath(7077))).toBe(false);
  });

  it("is idempotent — second call swallows ENOENT", () => {
    expect(() => removeLock(9999)).not.toThrow();
    expect(() => removeLock(9999)).not.toThrow();
  });
});

describe("studio-runtime/lockfile — listLocks", () => {
  it("returns parsed locks for studio-*.lock files only", () => {
    writeLock({
      pid: 4321,
      port: 7077,
      cmdline: "x",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    writeLock({
      pid: 4322,
      port: 7078,
      cmdline: "y",
      startedAt: "2026-05-07T12:00:01.000Z",
    });
    // Drop a non-matching file in the dir to confirm it's filtered out.
    fs.writeFileSync(path.join(runtimeDir(), "ignore-me.txt"), "hi");

    const all = listLocks();
    expect(all.map((l) => l.port).sort()).toEqual([7077, 7078]);
  });

  it("returns empty array when runtime dir is missing", () => {
    expect(listLocks()).toEqual([]);
  });

  it("skips locks whose JSON cannot be parsed", () => {
    fs.mkdirSync(runtimeDir(), { recursive: true });
    fs.writeFileSync(lockfilePath(7079), "garbage", { mode: 0o600 });
    expect(listLocks()).toEqual([]);
  });
});

describe("studio-runtime/lockfile — pruneStaleLocks", () => {
  it("prunes locks for dead PIDs", () => {
    // Pick a PID that is almost certainly not running. 999999999 is way past
    // typical OS PID_MAX on macOS/Linux. If we ever flake here we can pick a
    // value just above /proc/sys/kernel/pid_max but for unit-test scope this
    // suffices.
    writeLock({
      pid: 999_999_999,
      port: 7077,
      cmdline: "x",
      startedAt: new Date().toISOString(),
    });
    const live = pruneStaleLocks();
    expect(live).toEqual([]);
    expect(fs.existsSync(lockfilePath(7077))).toBe(false);
  });

  it("keeps lock for our own PID (alive)", () => {
    writeLock({
      pid: process.pid,
      port: 7077,
      cmdline: "x",
      startedAt: new Date().toISOString(),
    });
    const live = pruneStaleLocks();
    expect(live.length).toBe(1);
    expect(live[0].port).toBe(7077);
    expect(fs.existsSync(lockfilePath(7077))).toBe(true);
  });

  it("prunes locks older than 1 day even if PID happens to be alive", () => {
    const ancient = new Date("2000-01-01T00:00:00.000Z");
    writeLock({
      pid: process.pid,
      port: 7077,
      cmdline: "x",
      startedAt: ancient.toISOString(),
    });
    const live = pruneStaleLocks();
    expect(live).toEqual([]);
    expect(fs.existsSync(lockfilePath(7077))).toBe(false);
  });
});

describe("studio-runtime/lockfile — isPidAlive", () => {
  it("returns true for our own PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a definitely-not-running PID", () => {
    expect(isPidAlive(999_999_999)).toBe(false);
  });
});

describe("studio-runtime/lockfile — registerCleanup", () => {
  it("is idempotent — repeated calls don't pile up signal handlers", () => {
    const before = process.listenerCount("SIGINT");
    registerCleanup(7077);
    const afterFirst = process.listenerCount("SIGINT");
    registerCleanup(7077);
    const afterSecond = process.listenerCount("SIGINT");
    expect(afterSecond).toBe(afterFirst);
    // First call may have added one handler; second adds none.
    expect(afterFirst - before).toBeLessThanOrEqual(1);
  });
});
