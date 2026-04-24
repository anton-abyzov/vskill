// ---------------------------------------------------------------------------
// settings-store.ts — File-backed credential store for vSkill Studio.
//
// Single on-disk file at `<configDir>/keys.env` (default configDir:
// `~/.vskill`, overridable via VSKILL_CONFIG_DIR). KEY=VALUE dotenv format.
// Atomic write via temp-file + rename; POSIX writes explicit 0600.
//
// Contract:
//   - Raw keys NEVER appear in any log, error message, toast, or stdout.
//     Only `redactKey()` output (`****<last-4>`) may be emitted.
//   - `readKey()` consults `process.env` FIRST, then the in-memory map.
//     After `mergeStoredKeysIntoEnv()` the map is cleared; subsequent reads
//     hit process.env directly, minimizing plaintext dwell time.
//   - `listKeys()` returns { stored, updatedAt } metadata only.
//   - `removeKey()` is idempotent.
//   - Malformed lines in keys.env never crash parse — they are skipped with
//     exactly ONE aggregated warning.
//
// Tests inject `{logger, fs, configDir}` via `resetSettingsStore(opts)`.
// ---------------------------------------------------------------------------

import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PROVIDERS,
  type ProviderDescriptor,
  type ProviderId,
} from "./providers.js";

export type Provider = ProviderId;
export type { ProviderId } from "./providers.js";

export interface KeyMetadata {
  stored: boolean;
  updatedAt: string | null;
}

export interface ListKeysResponse {
  anthropic: KeyMetadata;
  openai: KeyMetadata;
  openrouter: KeyMetadata;
}

export interface Logger {
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

interface FsFacade {
  writeFileSync: typeof nodeFs.writeFileSync;
  renameSync: typeof nodeFs.renameSync;
  chmodSync: typeof nodeFs.chmodSync;
  readFileSync: typeof nodeFs.readFileSync;
  existsSync: typeof nodeFs.existsSync;
  unlinkSync: typeof nodeFs.unlinkSync;
  mkdirSync: typeof nodeFs.mkdirSync;
  statSync: typeof nodeFs.statSync;
}

interface Entry {
  key: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Module-level state. Tests reset via `resetSettingsStore()`.
// ---------------------------------------------------------------------------

const defaultLogger: Logger = {
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

// Wrappers read through the nodeFs namespace at CALL time so test files that
// mock `node:fs` without exporting every member (e.g. comparison-sse-events
// which only mocks existsSync/readFileSync/writeFileSync) don't fail at
// module-load time. Direct property access happens only inside the call.
const defaultFs: FsFacade = {
  writeFileSync: (...args) => nodeFs.writeFileSync(...(args as Parameters<typeof nodeFs.writeFileSync>)),
  renameSync: (...args) => nodeFs.renameSync(...(args as Parameters<typeof nodeFs.renameSync>)),
  chmodSync: (...args) => nodeFs.chmodSync(...(args as Parameters<typeof nodeFs.chmodSync>)),
  readFileSync: ((...args: unknown[]) =>
    (nodeFs.readFileSync as unknown as (...a: unknown[]) => unknown)(...args)) as typeof nodeFs.readFileSync,
  existsSync: (...args) => nodeFs.existsSync(...(args as Parameters<typeof nodeFs.existsSync>)),
  unlinkSync: (...args) => nodeFs.unlinkSync(...(args as Parameters<typeof nodeFs.unlinkSync>)),
  mkdirSync: ((...args: unknown[]) =>
    (nodeFs.mkdirSync as unknown as (...a: unknown[]) => unknown)(...args)) as typeof nodeFs.mkdirSync,
  statSync: ((...args: unknown[]) =>
    (nodeFs.statSync as unknown as (...a: unknown[]) => unknown)(...args)) as typeof nodeFs.statSync,
};

let logger: Logger = defaultLogger;
let fsImpl: FsFacade = defaultFs;
let configDirOverride: string | null = null;
const memoryMap = new Map<ProviderId, Entry>();
let loaded = false;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveConfigDir(): string {
  if (configDirOverride) return configDirOverride;
  const fromEnv = process.env.VSKILL_CONFIG_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), ".vskill");
}

export function getKeysFilePath(): string {
  return path.join(resolveConfigDir(), "keys.env");
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export function redactKey(key: string): string {
  if (!key || key.length <= 4) return "****";
  return "****" + key.slice(-4);
}

// ---------------------------------------------------------------------------
// Parser — lenient, single aggregated warning
// ---------------------------------------------------------------------------

function parseFile(contents: string): {
  entries: Map<ProviderId, Entry>;
  malformedCount: number;
} {
  const entries = new Map<ProviderId, Entry>();
  let malformedCount = 0;

  // Strip BOM.
  const stripped = contents.replace(/^\uFEFF/, "");
  const lines = stripped.split(/\r?\n/);

  const envToId = new Map<string, ProviderId>(
    PROVIDERS.map((p) => [p.envVarName, p.id]),
  );

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;

    try {
      const eq = line.indexOf("=");
      if (eq <= 0) {
        malformedCount++;
        continue;
      }
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (name.length === 0 || value.length === 0) {
        malformedCount++;
        continue;
      }
      const pid = envToId.get(name);
      if (!pid) {
        // Unknown env var name — skip silently (not "malformed", just
        // unrelated). Do NOT count toward malformedCount.
        continue;
      }
      entries.set(pid, { key: value, updatedAt: new Date().toISOString() });
    } catch {
      malformedCount++;
    }
  }

  return { entries, malformedCount };
}

function loadIfNeeded(): void {
  if (loaded) return;
  loaded = true;
  const filePath = getKeysFilePath();
  if (!fsImpl.existsSync(filePath)) return;
  try {
    const contents = fsImpl.readFileSync(filePath, "utf8");
    const { entries, malformedCount } = parseFile(contents as string);
    for (const [pid, entry] of entries) memoryMap.set(pid, entry);
    if (malformedCount > 0) {
      logger.warn(
        `[settings-store] ${malformedCount} malformed line(s) in ${filePath} were skipped`,
      );
    }
  } catch (err) {
    logger.warn(
      `[settings-store] failed to read ${filePath}: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function serialize(entries: Map<ProviderId, Entry>): string {
  const lines: string[] = [
    "# vskill credentials — do not commit. Managed by `vskill keys` or Skill Studio Settings.",
  ];
  for (const p of PROVIDERS) {
    const entry = entries.get(p.id);
    if (entry) lines.push(`${p.envVarName}=${entry.key}`);
  }
  return lines.join("\n") + "\n";
}

function atomicWrite(contents: string): void {
  const filePath = getKeysFilePath();
  const dir = path.dirname(filePath);
  fsImpl.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fsImpl.writeFileSync(tmpPath, contents, "utf8");
    if (process.platform !== "win32") {
      try {
        fsImpl.chmodSync(tmpPath, 0o600);
      } catch {
        /* non-fatal; rename will still proceed */
      }
    }
    fsImpl.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up tmp if present.
    try {
      if (fsImpl.existsSync(tmpPath)) fsImpl.unlinkSync(tmpPath);
    } catch {
      /* swallow */
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API — save / read / remove / list
// ---------------------------------------------------------------------------

export async function saveKey(
  provider: ProviderId,
  key: string,
): Promise<{ updatedAt: string }> {
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    throw new Error("key must be non-empty string");
  }
  loadIfNeeded();

  // Build the full entry set: current memory snapshot + new entry.
  const updatedAt = new Date().toISOString();
  const next = new Map(memoryMap);
  next.set(provider, { key, updatedAt });

  try {
    atomicWrite(serialize(next));
  } catch (err) {
    // NEVER include the raw key in the error message.
    const redacted = redactKey(key);
    logger.error(
      `[settings-store] saveKey(${provider}, ${redacted}) failed: ${(err as Error).message}`,
    );
    throw new Error(
      `saveKey(${provider}, ${redacted}) failed: ${(err as Error).message}`,
    );
  }

  memoryMap.set(provider, { key, updatedAt });
  return { updatedAt };
}

export function readKey(provider: ProviderId): string | null {
  loadIfNeeded();
  const descriptor = PROVIDERS.find(
    (p) => p.id === provider,
  ) as ProviderDescriptor | undefined;
  if (descriptor) {
    const fromEnv = process.env[descriptor.envVarName];
    if (fromEnv && fromEnv.length > 0) return fromEnv;
  }
  return memoryMap.get(provider)?.key ?? null;
}

export function readKeySync(provider: ProviderId): string | null {
  return readKey(provider);
}

export function hasKeySync(provider: ProviderId): boolean {
  return readKey(provider) !== null;
}

export async function removeKey(provider: ProviderId): Promise<void> {
  loadIfNeeded();
  if (!memoryMap.has(provider)) return;
  const next = new Map(memoryMap);
  next.delete(provider);
  try {
    atomicWrite(serialize(next));
  } catch (err) {
    logger.error(
      `[settings-store] removeKey(${provider}) failed: ${(err as Error).message}`,
    );
    throw err;
  }
  memoryMap.delete(provider);
}

export function listKeys(): ListKeysResponse {
  loadIfNeeded();
  const read = (p: ProviderId): KeyMetadata => {
    const e = memoryMap.get(p);
    return e
      ? { stored: true, updatedAt: e.updatedAt }
      : { stored: false, updatedAt: null };
  };
  return {
    anthropic: read("anthropic"),
    openai: read("openai"),
    openrouter: read("openrouter"),
  };
}

// ---------------------------------------------------------------------------
// Boot-time env merge
// ---------------------------------------------------------------------------

export function mergeStoredKeysIntoEnv(): void {
  loadIfNeeded();
  for (const p of PROVIDERS) {
    const entry = memoryMap.get(p.id);
    if (!entry) continue;
    // Nullish coalescing: real env vars always win.
    if (process.env[p.envVarName] === undefined) {
      process.env[p.envVarName] = entry.key;
    }
  }
  // Shrink plaintext dwell time.
  memoryMap.clear();
}

// ---------------------------------------------------------------------------
// Test DI hook
// ---------------------------------------------------------------------------

export interface ResetOptions {
  logger?: Logger;
  fs?: FsFacade;
  configDir?: string | null;
}

export function resetSettingsStore(opts: ResetOptions = {}): void {
  memoryMap.clear();
  loaded = false;
  logger = opts.logger ?? defaultLogger;
  fsImpl = opts.fs ?? defaultFs;
  configDirOverride = opts.configDir ?? null;
}
