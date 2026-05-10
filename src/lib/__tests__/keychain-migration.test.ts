// ---------------------------------------------------------------------------
// 0836 US-006 — keychain-migration tests (RED → GREEN).
//
// One-time migration that moves any token from the legacy slot
// `vskill-github::github_token` to the canonical
// `com.verifiedskill.desktop::github-oauth-token`. Idempotent under file-mutex
// at `~/.vskill/locks/keychain-migration.lock` (5s TTL); skip-flag at
// `~/.vskill/keychain-migration.done` short-circuits subsequent boots.
//
// State matrix covered:
//   (a) old populated, new empty                    → 'migrated'
//   (b) old populated, new populated                → 'migrated' (canonical wins, old deleted)
//   (c) both empty                                  → 'noop'
//   (d) lock held by another runner within TTL      → 'skipped'
//   (e) stale lock (older than TTL)                 → stolen, runs migration
//   (f) VSKILL_KEYCHAIN_MIGRATE=0 env var present   → 'skipped'
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runKeychainMigration } from "../migration/keychain-migration.js";
// 0836 hardening (F-007): _migrationRun is module-scoped global state.
// Tests that exercise `createKeychain` (rather than runKeychainMigration
// directly) hit a `if (!_migrationRun)` gate. Reset defensively each test
// so future suites don't inherit cross-case bleed.
import { _resetMigrationFlagForTests } from "../keychain.js";

interface FakeKeyring {
  store: Map<string, string>;
  available: boolean;
  setPassword: (svc: string, account: string, pwd: string) => void;
  getPassword: (svc: string, account: string) => string | null;
  deletePassword: (svc: string, account: string) => boolean;
}

function fakeKeyring(initial: Record<string, string> = {}): FakeKeyring {
  const store = new Map(Object.entries(initial));
  return {
    store,
    available: true,
    setPassword(svc, account, pwd) {
      store.set(`${svc}::${account}`, pwd);
    },
    getPassword(svc, account) {
      return store.get(`${svc}::${account}`) ?? null;
    },
    deletePassword(svc, account) {
      return store.delete(`${svc}::${account}`);
    },
  };
}

interface FakeFsState {
  files: Map<string, { content: string; mtimeMs: number }>;
}

function fakeFs(): FakeFsState {
  return { files: new Map() };
}

function makeFsAdapter(state: FakeFsState, now: () => number) {
  return {
    existsSync: (p: string) => state.files.has(p),
    readFileSync: (p: string) => {
      const f = state.files.get(p);
      if (!f) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      return f.content;
    },
    writeFileSync: (p: string, content: string) => {
      state.files.set(p, { content, mtimeMs: now() });
    },
    mkdirSync: (_p: string) => {},
    unlinkSync: (p: string) => {
      state.files.delete(p);
    },
    statSync: (p: string) => {
      const f = state.files.get(p);
      if (!f) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      return { mtimeMs: f.mtimeMs };
    },
  };
}

const LEGACY_KEY = "vskill-github::github_token";
const CANONICAL_KEY = "com.verifiedskill.desktop::github-oauth-token";

describe("0836 US-006 — keychain-migration", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.VSKILL_KEYCHAIN_MIGRATE;
    delete process.env.VSKILL_KEYCHAIN_MIGRATE;
    // 0836 hardening (F-007): reset the module-scoped run-once flag in
    // keychain.ts so each test starts from a clean state regardless of
    // whether a prior test (or a suite imported earlier) tripped it.
    _resetMigrationFlagForTests();
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VSKILL_KEYCHAIN_MIGRATE;
    else process.env.VSKILL_KEYCHAIN_MIGRATE = originalEnv;
    vi.restoreAllMocks();
  });

  it("AC-US6-03 (a): old slot only → moves token to canonical, deletes old, returns 'migrated'", () => {
    const kr = fakeKeyring({ [LEGACY_KEY]: "ghu_old_token_value" });
    const fsState = fakeFs();
    let t = 1_700_000_000_000;
    const now = () => t;
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
    });
    expect(result).toBe("migrated");
    expect(kr.store.get(CANONICAL_KEY)).toBe("ghu_old_token_value");
    expect(kr.store.has(LEGACY_KEY)).toBe(false);
  });

  it("AC-US6-03 (b): both slots populated → canonical wins, old deleted, returns 'migrated'", () => {
    const kr = fakeKeyring({
      [LEGACY_KEY]: "old-stale",
      [CANONICAL_KEY]: "new-fresh",
    });
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
    });
    expect(result).toBe("migrated");
    // Canonical kept (newer), old slot cleaned up.
    expect(kr.store.get(CANONICAL_KEY)).toBe("new-fresh");
    expect(kr.store.has(LEGACY_KEY)).toBe(false);
  });

  it("AC-US6-08 (c): both slots empty → returns 'noop' and writes done flag", () => {
    const kr = fakeKeyring();
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
    });
    expect(result).toBe("noop");
    // Done flag should be written so the next boot short-circuits.
    const doneEntry = Array.from(fsState.files.keys()).find((k) =>
      k.endsWith("keychain-migration.done"),
    );
    expect(doneEntry, "done flag must be written").toBeTruthy();
  });

  it("done flag short-circuits to 'skipped' on subsequent boots", () => {
    const kr = fakeKeyring({ [LEGACY_KEY]: "should-not-move" });
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    // Pre-write the done flag — simulates a prior successful migration.
    fsState.files.set("/home/test/.vskill/keychain-migration.done", {
      content: "1",
      mtimeMs: now(),
    });
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
      homeDir: "/home/test",
    });
    expect(result).toBe("skipped");
    // Old slot must remain untouched (we honored the done flag).
    expect(kr.store.get(LEGACY_KEY)).toBe("should-not-move");
  });

  it("AC-US6-04 (d): lock held by another runner within TTL → returns 'skipped'", () => {
    const kr = fakeKeyring({ [LEGACY_KEY]: "still-here" });
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    // Pre-place a fresh lock from another process — within 5s TTL.
    fsState.files.set("/home/test/.vskill/locks/keychain-migration.lock", {
      content: "9999",
      mtimeMs: now() - 1_000, // 1s ago — well within TTL
    });
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
      homeDir: "/home/test",
    });
    expect(result).toBe("skipped");
    // Old slot must remain (the other runner will handle it).
    expect(kr.store.get(LEGACY_KEY)).toBe("still-here");
  });

  it("AC-US6-04 (e): stale lock (>5s TTL) is stolen and migration runs", () => {
    const kr = fakeKeyring({ [LEGACY_KEY]: "ghu_stale" });
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    // Pre-place a stale lock — older than 5s.
    fsState.files.set("/home/test/.vskill/locks/keychain-migration.lock", {
      content: "9999",
      mtimeMs: now() - 10_000, // 10s ago
    });
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
      homeDir: "/home/test",
    });
    expect(result).toBe("migrated");
    expect(kr.store.get(CANONICAL_KEY)).toBe("ghu_stale");
    expect(kr.store.has(LEGACY_KEY)).toBe(false);
  });

  it("AC-US6-07 (f): VSKILL_KEYCHAIN_MIGRATE=0 env disables migration", () => {
    process.env.VSKILL_KEYCHAIN_MIGRATE = "0";
    const kr = fakeKeyring({ [LEGACY_KEY]: "ghu_should_not_move" });
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    const result = runKeychainMigration({
      keyring: kr,
      fs: makeFsAdapter(fsState, now),
      now,
    });
    expect(result).toBe("skipped");
    // Old slot intact, no done flag (still want migration on next boot).
    expect(kr.store.get(LEGACY_KEY)).toBe("ghu_should_not_move");
    expect(kr.store.has(CANONICAL_KEY)).toBe(false);
  });

  it("returns 'skipped' when the keyring backend is unavailable", () => {
    const fsState = fakeFs();
    const now = () => 1_700_000_000_000;
    const result = runKeychainMigration({
      keyring: null, // backend missing (e.g., headless Linux without libsecret)
      fs: makeFsAdapter(fsState, now),
      now,
    });
    expect(result).toBe("skipped");
  });
});
