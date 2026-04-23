// ---------------------------------------------------------------------------
// settings-store.ts — Tiered API key storage for vSkill Studio (0682 / US-004).
//
// Two tiers:
//   - "browser"   (default, all platforms) — in-memory map keyed by provider.
//                 The browser mirrors the write into localStorage so a page
//                 reload does not require re-entry.
//   - "keychain"  (Darwin opt-in) — shells out to the `security` binary to
//                 store under `vskill-<provider>`. No native-module dep.
//
// Contract:
//   - Keys NEVER appear in any log, error, toast, network URL, or stdout.
//     The only redacted form ever emitted is `****<last-4>` via `redactKey`.
//   - `listKeys()` returns metadata only (stored boolean, updatedAt, tier).
//   - `removeKey()` is idempotent.
//   - Tier switch (setTier) wipes the old tier's entry and re-saves into the
//     new tier so the live state stays coherent.
//
// Tests inject a fake logger + a fake spawn factory so the Darwin path is
// exercisable on any host. See __tests__/settings-store.test.ts.
// ---------------------------------------------------------------------------

import * as childProcess from "node:child_process";
import type { SpawnOptions } from "node:child_process";

// Lazy accessor — some test files mock `node:child_process` without re-
// exporting `spawn`. Reading through the namespace at call time avoids
// touching the mock at module-load time, so those tests keep passing.
const realSpawn: typeof childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) =>
  (childProcess.spawn as unknown as (...a: unknown[]) => ReturnType<typeof childProcess.spawn>)(
    ...args,
  )) as typeof childProcess.spawn;

export type Provider = "anthropic" | "openrouter";
export type Tier = "browser" | "keychain";

export interface KeyMetadata {
  stored: boolean;
  updatedAt: string | null;
  tier: Tier;
}

export interface ListKeysResponse {
  anthropic: KeyMetadata;
  openrouter: KeyMetadata;
}

export class UnsupportedTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTierError";
  }
}

export function redactKey(key: string): string {
  if (!key || key.length <= 4) return "****";
  return "****" + key.slice(-4);
}

// ---------------------------------------------------------------------------
// Module-level state (per-process). Tests call `resetSettingsStore()`.
// ---------------------------------------------------------------------------

interface Entry {
  key: string;
  updatedAt: string;
  tier: Tier;
}

const store = new Map<Provider, Entry>();
let currentTier: Tier = "browser";

// Injectable logger + spawn for tests.
type Logger = {
  warn: (msg: string) => void;
  error: (msg: string) => void;
};
let logger: Logger = {
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};
let spawn: typeof realSpawn = realSpawn;
let platformOverride: NodeJS.Platform | null = null;

export function _setLogger(l: Logger): void {
  logger = l;
}
export function _setSpawn(s: typeof realSpawn): void {
  spawn = s;
}
export function _setPlatformOverride(p: NodeJS.Platform | null): void {
  platformOverride = p;
}
export function resetSettingsStore(): void {
  store.clear();
  currentTier = "browser";
  platformOverride = null;
  logger = {
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
  };
  spawn = realSpawn;
}

function getPlatform(): NodeJS.Platform {
  return platformOverride ?? process.platform;
}

// ---------------------------------------------------------------------------
// Tier management
// ---------------------------------------------------------------------------

export function getTier(): Tier {
  return currentTier;
}

export async function setTier(tier: Tier): Promise<void> {
  if (tier === "keychain" && getPlatform() !== "darwin") {
    throw new UnsupportedTierError(
      "macOS Keychain tier is only supported on Darwin",
    );
  }
  if (tier === currentTier) return;

  // Move every stored key into the new tier.
  const entries = Array.from(store.entries());
  for (const [provider, entry] of entries) {
    if (tier === "keychain") {
      await keychainAdd(provider, entry.key);
      store.set(provider, { ...entry, tier });
    } else {
      // Switching browser → keychain → browser is also supported; clear the
      // keychain entry so it doesn't linger.
      await keychainDelete(provider).catch(() => {});
      store.set(provider, { ...entry, tier });
    }
  }
  currentTier = tier;
}

// ---------------------------------------------------------------------------
// Public API — save / read / remove / list
// ---------------------------------------------------------------------------

export async function saveKey(
  provider: Provider,
  key: string,
  tier: Tier = currentTier,
): Promise<{ updatedAt: string; tier: Tier }> {
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    throw new Error("key must be non-empty string");
  }
  if (tier === "keychain" && getPlatform() !== "darwin") {
    throw new UnsupportedTierError(
      "macOS Keychain tier is only supported on Darwin",
    );
  }

  const updatedAt = new Date().toISOString();
  try {
    if (tier === "keychain") {
      await keychainAdd(provider, key);
    }
    store.set(provider, { key, updatedAt, tier });
    currentTier = tier;
    return { updatedAt, tier };
  } catch (err) {
    // NEVER log the raw key — only the redacted form.
    logger.error(
      `[settings-store] saveKey(${provider}, ${redactKey(key)}) failed: ${(err as Error).message}`,
    );
    throw err;
  }
}

export function readKey(provider: Provider): string | null {
  return store.get(provider)?.key ?? null;
}

/** Synchronous accessor used by detectAvailableProviders — safe, same semantics. */
export function readKeySync(provider: Provider): string | null {
  return readKey(provider);
}

/** Has-key predicate exposed for synchronous availability checks. */
export function hasKeySync(provider: Provider): boolean {
  return store.has(provider);
}

export async function removeKey(provider: Provider): Promise<void> {
  const entry = store.get(provider);
  if (!entry) return;
  if (entry.tier === "keychain") {
    try {
      await keychainDelete(provider);
    } catch (err) {
      logger.warn(
        `[settings-store] keychain remove for ${provider} failed: ${(err as Error).message}`,
      );
    }
  }
  store.delete(provider);
}

export function listKeys(): ListKeysResponse {
  const read = (p: Provider): KeyMetadata => {
    const e = store.get(p);
    return e
      ? { stored: true, updatedAt: e.updatedAt, tier: e.tier }
      : { stored: false, updatedAt: null, tier: currentTier };
  };
  return { anthropic: read("anthropic"), openrouter: read("openrouter") };
}

// ---------------------------------------------------------------------------
// Darwin Keychain bridge via `security` binary.
// ---------------------------------------------------------------------------

function keychainAdd(provider: Provider, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "add-generic-password",
      "-s",
      `vskill-${provider}`,
      "-a",
      "vskill-user",
      "-w",
      key,
      "-U",
    ];
    const opts: SpawnOptions = { stdio: ["ignore", "pipe", "pipe"] };
    const child = spawn("security", args, opts);
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`security add-generic-password exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

function keychainDelete(provider: Provider): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "security",
      ["delete-generic-password", "-s", `vskill-${provider}`, "-a", "vskill-user"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0 || code === 44) resolve(); // 44 = not found, idempotent
      else resolve(); // be lenient — delete must not block removeKey
    });
  });
}
