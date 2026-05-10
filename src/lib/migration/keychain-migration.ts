// ---------------------------------------------------------------------------
// 0836 US-006 — keychain migration: legacy slot → canonical slot.
//
// Pre-0836:  Node CLI used  `vskill-github::github_token`   (legacy)
// Post-0836: Node CLI uses  `com.verifiedskill.desktop::github-oauth-token`
//                            (canonical — also the Rust desktop's slot per
//                             ADR-0836-03)
//
// This module runs ONCE on Node-side boot (via `keychain.ts::createKeychain`)
// and migrates any token from the legacy slot to the canonical slot. The
// move is idempotent + race-safe via a 5s-TTL file mutex at
// `~/.vskill/locks/keychain-migration.lock`. A done-flag at
// `~/.vskill/keychain-migration.done` short-circuits subsequent boots.
//
// Rust does NOT participate — `src-tauri/src/auth/token_store.rs` is already
// on the canonical slot (locked by a constant test there).
//
// Removal target: drop this whole module + the legacy fallback in
// keychain.ts AFTER vskill 1.1.x. Anton: remember to bump.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";

const LEGACY_SERVICE = "vskill-github";
const LEGACY_ACCOUNT = "github_token";
const CANONICAL_SERVICE = "com.verifiedskill.desktop";
const CANONICAL_ACCOUNT = "github-oauth-token";

const LOCK_TTL_MS = 5_000;

export type MigrationResult = "migrated" | "noop" | "skipped";

export interface KeyringBackend {
  setPassword(service: string, account: string, password: string): void;
  getPassword(service: string, account: string): string | null;
  deletePassword(service: string, account: string): boolean;
}

export interface MigrationFsAdapter {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string) => string;
  writeFileSync: (p: string, content: string) => void;
  mkdirSync: (p: string) => void;
  unlinkSync: (p: string) => void;
  statSync: (p: string) => { mtimeMs: number };
}

export interface MigrationDeps {
  keyring: KeyringBackend | null;
  fs?: MigrationFsAdapter;
  now?: () => number;
  homeDir?: string;
}

const defaultFs: MigrationFsAdapter = {
  existsSync: (p) => nodeFs.existsSync(p),
  readFileSync: (p) => nodeFs.readFileSync(p, { encoding: "utf8" }),
  writeFileSync: (p, c) =>
    nodeFs.writeFileSync(p, c, { encoding: "utf8", mode: 0o600 }),
  mkdirSync: (p) => {
    nodeFs.mkdirSync(p, { recursive: true, mode: 0o700 });
  },
  unlinkSync: (p) => nodeFs.unlinkSync(p),
  statSync: (p) => {
    const s = nodeFs.statSync(p);
    return { mtimeMs: s.mtimeMs };
  },
};

interface MigrationPaths {
  doneFlag: string;
  lockFile: string;
  lockDir: string;
}

function paths(homeDir: string): MigrationPaths {
  const root = nodePath.join(homeDir, ".vskill");
  return {
    doneFlag: nodePath.join(root, "keychain-migration.done"),
    lockFile: nodePath.join(root, "locks", "keychain-migration.lock"),
    lockDir: nodePath.join(root, "locks"),
  };
}

/**
 * Runs the legacy → canonical migration with mutex serialization.
 *
 * Returns:
 *   - 'migrated' — token moved (or both slots cleaned up)
 *   - 'noop'     — nothing to migrate; done flag written
 *   - 'skipped'  — environment opt-out, missing keyring, done flag, or
 *                  another runner holds a fresh lock
 *
 * Idempotent — running twice is safe (the second call sees the done flag
 * and returns 'skipped').
 */
export function runKeychainMigration(deps: MigrationDeps): MigrationResult {
  // Env opt-out — power users / CI can set VSKILL_KEYCHAIN_MIGRATE=0.
  if (process.env.VSKILL_KEYCHAIN_MIGRATE === "0") {
    return "skipped";
  }

  if (!deps.keyring) return "skipped";

  const fs = deps.fs ?? defaultFs;
  const now = deps.now ?? Date.now;
  const home = deps.homeDir ?? nodeOs.homedir();
  const p = paths(home);

  // Done-flag short-circuit — prior boot already migrated.
  if (fs.existsSync(p.doneFlag)) return "skipped";

  // Acquire lock.
  if (!acquireLock(fs, p, now)) {
    return "skipped";
  }

  try {
    return migrateUnderLock(deps.keyring, fs, p, now);
  } finally {
    releaseLock(fs, p);
  }
}

function acquireLock(
  fs: MigrationFsAdapter,
  p: MigrationPaths,
  now: () => number,
): boolean {
  // Ensure parent dir exists.
  try {
    fs.mkdirSync(p.lockDir);
  } catch {
    // ignore — parent may already exist
  }

  if (fs.existsSync(p.lockFile)) {
    // Check staleness.
    let stale = false;
    try {
      const stat = fs.statSync(p.lockFile);
      stale = now() - stat.mtimeMs > LOCK_TTL_MS;
    } catch {
      stale = true; // can't stat → treat as stale and steal
    }
    if (!stale) {
      // Another runner holds a fresh lock — back off.
      return false;
    }
    // Steal.
    try {
      fs.unlinkSync(p.lockFile);
    } catch {
      // ignore — race with the other runner releasing it
    }
  }

  try {
    fs.writeFileSync(p.lockFile, String(process.pid));
  } catch {
    return false;
  }
  return true;
}

function releaseLock(fs: MigrationFsAdapter, p: MigrationPaths): void {
  try {
    fs.unlinkSync(p.lockFile);
  } catch {
    // ignore
  }
}

function migrateUnderLock(
  keyring: KeyringBackend,
  fs: MigrationFsAdapter,
  p: MigrationPaths,
  _now: () => number,
): MigrationResult {
  const old = safeGet(keyring, LEGACY_SERVICE, LEGACY_ACCOUNT);
  const canonical = safeGet(keyring, CANONICAL_SERVICE, CANONICAL_ACCOUNT);

  if (old == null && canonical == null) {
    writeDoneFlag(fs, p);
    return "noop";
  }

  if (old != null && canonical == null) {
    // Promote old → canonical, then drop old.
    safeSet(keyring, CANONICAL_SERVICE, CANONICAL_ACCOUNT, old);
    safeDelete(keyring, LEGACY_SERVICE, LEGACY_ACCOUNT);
    writeDoneFlag(fs, p);
    return "migrated";
  }

  if (old != null && canonical != null) {
    // Both populated — keep canonical (newer), delete old.
    safeDelete(keyring, LEGACY_SERVICE, LEGACY_ACCOUNT);
    writeDoneFlag(fs, p);
    return "migrated";
  }

  // canonical-only: nothing to do; mark done so we don't re-check.
  writeDoneFlag(fs, p);
  return "noop";
}

function writeDoneFlag(fs: MigrationFsAdapter, p: MigrationPaths): void {
  try {
    fs.writeFileSync(p.doneFlag, "1");
  } catch {
    // Best-effort — if the flag can't be written, the migration just
    // re-runs next boot; harmless because each step is idempotent.
  }
}

function safeGet(
  kr: KeyringBackend,
  service: string,
  account: string,
): string | null {
  try {
    return kr.getPassword(service, account);
  } catch {
    return null;
  }
}

function safeSet(
  kr: KeyringBackend,
  service: string,
  account: string,
  value: string,
): void {
  try {
    kr.setPassword(service, account, value);
  } catch {
    // ignore — failure is logged elsewhere; migration continues
  }
}

function safeDelete(
  kr: KeyringBackend,
  service: string,
  account: string,
): void {
  try {
    kr.deletePassword(service, account);
  } catch {
    // ignore
  }
}
