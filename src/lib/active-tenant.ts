// ---------------------------------------------------------------------------
// active-tenant.ts — read/write `currentTenant` in `~/.vskill/config.json`.
//
// 0839 US-002 / US-003 / US-004:
//   The same file is the single source of truth for "active tenant" across
//   the CLI (read by the resolver in `commands/add.ts`, written by
//   `commands/orgs.ts`) AND Studio (read/written via the eval-server's
//   `/__internal/active-tenant` route — which reuses these helpers).
//
//   `setActiveTenant` MUST preserve unknown keys (forward-compat with
//   future config additions, AC-US3-06) and write atomically (write to
//   `.tmp`, rename) so a Studio + CLI race never corrupts the file.
//
// Path: `${VSKILL_CONFIG_DIR ?? ~/.vskill}/config.json`
// Schema: `{ currentTenant?: string, ...unknownKeys }`
// ---------------------------------------------------------------------------

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";

export interface ActiveTenantOptions {
  /** Override config dir (tests). Defaults to `~/.vskill`. */
  configDir?: string;
  /** Filesystem adapter for tests. */
  fs?: ActiveTenantFs;
}

export interface ActiveTenantFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
  writeFileSync(path: string, content: string, mode: number): void;
  renameSync(oldPath: string, newPath: string): void;
  mkdirSync(path: string): void;
  unlinkSync(path: string): void;
}

const defaultFs: ActiveTenantFs = {
  existsSync: (p) => nodeFs.existsSync(p),
  readFileSync: (p) => nodeFs.readFileSync(p, { encoding: "utf8" }),
  writeFileSync: (p, c, mode) =>
    nodeFs.writeFileSync(p, c, { encoding: "utf8", mode }),
  renameSync: (a, b) => nodeFs.renameSync(a, b),
  mkdirSync: (p) => nodeFs.mkdirSync(p, { recursive: true, mode: 0o700 }),
  unlinkSync: (p) => nodeFs.unlinkSync(p),
};

function resolveConfigDir(opts: ActiveTenantOptions = {}): string {
  if (opts.configDir) return opts.configDir;
  if (process.env.VSKILL_CONFIG_DIR) return process.env.VSKILL_CONFIG_DIR;
  return nodePath.join(nodeOs.homedir(), ".vskill");
}

function configPath(opts: ActiveTenantOptions = {}): string {
  return nodePath.join(resolveConfigDir(opts), "config.json");
}

function readConfigObject(
  opts: ActiveTenantOptions = {},
): Record<string, unknown> {
  const fs = opts.fs ?? defaultFs;
  const p = configPath(opts);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p);
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // Corrupt file — treat as empty so the caller can recover by writing.
    return {};
  }
}

/**
 * Read the active tenant slug. Returns null when the config file is
 * missing, unreadable, or has no `currentTenant` field.
 */
export function getActiveTenant(opts: ActiveTenantOptions = {}): string | null {
  const obj = readConfigObject(opts);
  const v = obj.currentTenant;
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/**
 * Write the active tenant slug. Preserves unknown keys (read-modify-write
 * merge, AC-US3-06) and uses an atomic .tmp + rename so a concurrent CLI
 * + Studio write never observes a partial file.
 *
 * Pass `null` to clear `currentTenant` while preserving the rest of the
 * config (e.g. `vskill orgs use --clear` later).
 */
export function setActiveTenant(
  slug: string | null,
  opts: ActiveTenantOptions = {},
): void {
  const fs = opts.fs ?? defaultFs;
  const dir = resolveConfigDir(opts);
  const p = configPath(opts);

  // Read-modify-write so unknown keys survive.
  const obj = readConfigObject(opts);
  if (slug === null) {
    delete obj.currentTenant;
  } else {
    obj.currentTenant = slug;
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  // Atomic write: stage to a unique .tmp sibling, then rename. Suffix the
  // tmp filename with the PID so two concurrent writers never collide on
  // the same temp path; the final rename is the atomicity primitive.
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", 0o600);
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    // Best-effort cleanup of the staging file so we don't leak it.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* swallow — the rename error is the meaningful signal */
    }
    throw err;
  }
}

/**
 * Read the entire config object (forward-compat — surfaces all keys, not
 * just `currentTenant`). Returns an empty object when the file is missing
 * or corrupt.
 */
export function readConfig(
  opts: ActiveTenantOptions = {},
): Record<string, unknown> {
  return readConfigObject(opts);
}

/** Resolve the path the helpers will read/write. Useful for diagnostics. */
export function getConfigPath(opts: ActiveTenantOptions = {}): string {
  return configPath(opts);
}
