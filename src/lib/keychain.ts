// ---------------------------------------------------------------------------
// keychain.ts — OS-level secure storage for the vskill CLI's GitHub token.
//
// Backend selection (in order):
//   1. @napi-rs/keyring (macOS Keychain / Windows DPAPI / libsecret on Linux)
//   2. ~/.vskill/keys.env file with mode 0600 (when keyring is unavailable —
//      headless Linux without keyring daemon, sandboxed environments, etc.)
//
// Public surface:
//   - getGitHubToken(): string | null
//   - setGitHubToken(token: string): void
//   - clearGitHubToken(): boolean   /// true if a token was removed
//
// Tokens are NEVER logged. Callers should redact via `redactToken()` before
// any user-facing output.
//
// Service identity (0836 US-006 — canonical, shared with the Rust desktop):
//   - service:  "com.verifiedskill.desktop"   (was "vskill-github")
//   - account:  "github-oauth-token"          (was "github_token")
//
// On first construction we run a one-time migration that moves any token
// from the legacy slot into the canonical slot. The legacy fallback in
// `getGitHubToken` covers users who haven't yet booted a process that ran
// the migration (e.g., the Rust desktop wrote the canonical slot, but a
// vintage CLI install reads from the old one). Both paths are scheduled
// for removal AFTER vskill 1.1.x — see keychain-migration.ts for the
// removal target.
// ---------------------------------------------------------------------------

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { runKeychainMigration } from "./migration/keychain-migration.js";

export const SERVICE_NAME = "com.verifiedskill.desktop";
export const GITHUB_TOKEN_KEY = "github-oauth-token";

// 0836 US-006: legacy slot — read-only fallback during the one-release
// compat window. Remove after vskill 1.1.x ships.
// TODO(0836-followup): drop LEGACY_SERVICE_NAME + LEGACY_TOKEN_KEY + the
// fallback branch in getGitHubToken once 1.1.x has had one full release
// cycle to migrate users.
const LEGACY_SERVICE_NAME = "vskill-github";
const LEGACY_TOKEN_KEY = "github_token";

export interface KeyringBackend {
  setPassword(service: string, account: string, password: string): void;
  getPassword(service: string, account: string): string | null;
  deletePassword(service: string, account: string): boolean;
}

export interface FsAdapter {
  readFileSync(path: string): string;
  writeFileSync(path: string, content: string, mode: number): void;
  chmodSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string): void;
  unlinkSync(path: string): void;
}

export interface KeychainOptions {
  /** Optional keyring backend; defaults to a real `@napi-rs/keyring` adapter. */
  keyring?: KeyringBackend | null;
  /** Filesystem adapter (override for tests). */
  fs?: FsAdapter;
  /** Absolute path to the fallback file. Defaults to `~/.vskill/keys.env`. */
  fallbackPath?: string;
  /** Warn channel — receives one message when fallback kicks in. */
  warn?: (message: string) => void;
}

export interface Keychain {
  setGitHubToken(token: string): void;
  getGitHubToken(): string | null;
  clearGitHubToken(): boolean;
  /** True iff fallback storage is in use (introspection for `vskill auth status`). */
  usingFallback(): boolean;
}

const DEFAULT_FALLBACK = nodePath.join(nodeOs.homedir(), ".vskill", "keys.env");

const defaultFs: FsAdapter = {
  readFileSync: (p) => nodeFs.readFileSync(p, { encoding: "utf8" }),
  writeFileSync: (p, c, mode) =>
    nodeFs.writeFileSync(p, c, { encoding: "utf8", mode }),
  chmodSync: (p, mode) => nodeFs.chmodSync(p, mode),
  existsSync: (p) => nodeFs.existsSync(p),
  mkdirSync: (p) => nodeFs.mkdirSync(p, { recursive: true, mode: 0o700 }),
  unlinkSync: (p) => nodeFs.unlinkSync(p),
};

// 0836 US-006: per-process flag so the one-time migration runs exactly
// once even if multiple keychains are constructed (the test suite does
// this; production has a single default keychain).
let _migrationRun = false;

/** Test-only — reset the migration-once flag so test factories can re-run it. */
export function _resetMigrationFlagForTests(): void {
  _migrationRun = false;
}

function loadDefaultKeyring(): KeyringBackend | null {
  // The native module is loaded lazily so the CLI still boots in environments
  // where the binary isn't available (rare, since @napi-rs/keyring ships
  // prebuilds for the major platforms — but we never want a missing native to
  // crash unrelated subcommands like `vskill --version`).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@napi-rs/keyring") as {
      Entry: new (service: string, account: string) => {
        setPassword(pwd: string): void;
        getPassword(): string | null;
        deletePassword(): boolean;
      };
    };
    return {
      setPassword(service, account, password) {
        const entry = new mod.Entry(service, account);
        entry.setPassword(password);
      },
      getPassword(service, account) {
        try {
          const entry = new mod.Entry(service, account);
          return entry.getPassword();
        } catch {
          return null;
        }
      },
      deletePassword(service, account) {
        try {
          const entry = new mod.Entry(service, account);
          return entry.deletePassword();
        } catch {
          return false;
        }
      },
    };
  } catch {
    return null;
  }
}

function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    map.set(key, val);
  }
  return map;
}

function serializeEnvMap(map: Map<string, string>): string {
  const lines: string[] = [
    "# vskill keys.env — fallback secret store (mode 0600).",
    "# Managed by vskill; edit at your own risk.",
  ];
  for (const [k, v] of map) lines.push(`${k}=${v}`);
  return lines.join("\n") + "\n";
}

export function createKeychain(opts: KeychainOptions = {}): Keychain {
  const fs = opts.fs ?? defaultFs;
  const fallbackPath = opts.fallbackPath ?? DEFAULT_FALLBACK;
  const warn = opts.warn ?? ((msg) => process.stderr.write(`${msg}\n`));

  let keyring: KeyringBackend | null;
  if (opts.keyring !== undefined) keyring = opts.keyring;
  else keyring = loadDefaultKeyring();

  // 0836 US-006: run the one-time legacy-slot → canonical-slot migration
  // exactly once per process. The helper is idempotent (skip-flag +
  // mutex), so calling it on every createKeychain construction is safe;
  // the per-process flag is only an optimization to avoid the cheap
  // file-stat check on every test factory.
  if (!_migrationRun) {
    _migrationRun = true;
    try {
      runKeychainMigration({ keyring });
    } catch {
      // Best-effort — migration failure leaves the legacy fallback path
      // intact; no user-visible regression.
    }
  }

  let warnedFallback = false;
  let fallbackInUse = false;

  function tryKeyring<T>(fn: (kr: KeyringBackend) => T): { ok: true; value: T } | { ok: false } {
    if (!keyring) return { ok: false };
    try {
      return { ok: true, value: fn(keyring) };
    } catch {
      return { ok: false };
    }
  }

  function ensureFallbackWarned(): void {
    fallbackInUse = true;
    if (warnedFallback) return;
    warnedFallback = true;
    warn(
      `vskill: OS keychain unavailable; storing GitHub token at ${fallbackPath} (mode 0600).`,
    );
  }

  function readFallback(): Map<string, string> {
    if (!fs.existsSync(fallbackPath)) return new Map();
    try {
      return parseEnvFile(fs.readFileSync(fallbackPath));
    } catch {
      return new Map();
    }
  }

  function writeFallback(map: Map<string, string>): void {
    const dir = nodePath.dirname(fallbackPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(fallbackPath, serializeEnvMap(map), 0o600);
    fs.chmodSync(fallbackPath, 0o600);
  }

  return {
    setGitHubToken(token: string): void {
      if (!token || typeof token !== "string") {
        throw new Error("setGitHubToken: token must be a non-empty string");
      }
      const r = tryKeyring((kr) => kr.setPassword(SERVICE_NAME, GITHUB_TOKEN_KEY, token));
      if (r.ok) return;
      ensureFallbackWarned();
      const map = readFallback();
      map.set(GITHUB_TOKEN_KEY, token);
      writeFallback(map);
    },

    getGitHubToken(): string | null {
      const r = tryKeyring((kr) => kr.getPassword(SERVICE_NAME, GITHUB_TOKEN_KEY));
      if (r.ok && r.value) {
        // 0836 hardening (F-008 follow-up): if BOTH the canonical and the
        // legacy slots are populated, log a WARN. This catches the
        // dual-writer drift case where a vintage `vskill@<old>` install
        // wrote to legacy after migration's done-flag was set. Canonical
        // wins (current return), but operators get a signal the user has
        // two copies and should re-authenticate.
        try {
          const legacy = tryKeyring((kr) =>
            kr.getPassword(LEGACY_SERVICE_NAME, LEGACY_TOKEN_KEY),
          );
          if (legacy.ok && legacy.value && legacy.value !== r.value) {
            // Avoid logging the token values themselves — only the fact of drift.
            // eslint-disable-next-line no-console
            console.warn(
              "[vskill keychain] both canonical and legacy slots are populated; canonical wins. Run `vskill auth login` to clear drift.",
            );
          }
        } catch {
          // Non-fatal: drift detection is best-effort.
        }
        return r.value;
      }
      if (r.ok && r.value === null) {
        // 0836 US-006 legacy fallback: a vintage CLI install that hasn't
        // booted post-migration may still hold the token in the old slot.
        // Honor it for one release window. The migration helper will move
        // this on the next process boot; until then we read from where it
        // lives.
        // TODO(0836-followup): remove after vskill 1.1.x ships.
        const legacy = tryKeyring((kr) =>
          kr.getPassword(LEGACY_SERVICE_NAME, LEGACY_TOKEN_KEY),
        );
        if (legacy.ok && legacy.value) return legacy.value;

        // keyring works but slot is empty — also peek at fallback in case the
        // user set a token before keyring became available, but DO NOT warn
        // because keyring is fine.
        const map = readFallback();
        if (map.has(GITHUB_TOKEN_KEY)) return map.get(GITHUB_TOKEN_KEY) ?? null;
        // 0836 US-006: legacy file-fallback key, kept for the same
        // one-release window as the legacy keyring service.
        return map.get(LEGACY_TOKEN_KEY) ?? null;
      }
      ensureFallbackWarned();
      const map = readFallback();
      if (map.has(GITHUB_TOKEN_KEY)) return map.get(GITHUB_TOKEN_KEY) ?? null;
      return map.get(LEGACY_TOKEN_KEY) ?? null;
    },

    clearGitHubToken(): boolean {
      let removed = false;
      const r = tryKeyring((kr) => kr.deletePassword(SERVICE_NAME, GITHUB_TOKEN_KEY));
      if (r.ok && r.value) removed = true;
      // Always also clear the fallback — defense in depth in case both backends
      // hold copies (e.g., keyring re-enabled after a fallback period).
      if (fs.existsSync(fallbackPath)) {
        const map = readFallback();
        if (map.delete(GITHUB_TOKEN_KEY)) {
          if (map.size === 0) {
            try {
              fs.unlinkSync(fallbackPath);
            } catch {
              writeFallback(map);
            }
          } else {
            writeFallback(map);
          }
          removed = true;
        }
      }
      return removed;
    },

    usingFallback(): boolean {
      return fallbackInUse || keyring === null;
    },
  };
}

/**
 * Convenience accessor used by every CLI surface that needs the GitHub token.
 * Lazily constructs a default keychain on first call.
 */
let _defaultKeychain: Keychain | null = null;
export function getDefaultKeychain(): Keychain {
  if (_defaultKeychain) return _defaultKeychain;
  _defaultKeychain = createKeychain();
  return _defaultKeychain;
}

/** Test-only reset hook — never call from production code. */
export function _resetDefaultKeychainForTests(): void {
  _defaultKeychain = null;
}

export function getGitHubToken(): string | null {
  return getDefaultKeychain().getGitHubToken();
}

export function setGitHubToken(token: string): void {
  getDefaultKeychain().setGitHubToken(token);
}

export function clearGitHubToken(): boolean {
  return getDefaultKeychain().clearGitHubToken();
}

/** Last-4 redaction for log-safe output. */
export function redactToken(token: string | null | undefined): string {
  if (!token) return "(none)";
  if (token.length <= 8) return "****";
  return `****${token.slice(-4)}`;
}
