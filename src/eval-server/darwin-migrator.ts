// ---------------------------------------------------------------------------
// darwin-migrator.ts — Optional one-shot migration from the pre-0702
// macOS Keychain storage model to the new file-backed settings store.
//
// Shape:
//   - `available()`  → probes the keychain for legacy entries so the UI can
//                      decide whether to show a migration banner.
//   - `migrate()`    → copies each legacy entry into the file store, writes
//                      a state file so this run is idempotent.
//   - `acknowledge()` → user dismissed the banner; records ackedAt so we
//                      don't prompt again within the 30-day grace window.
//
// Security: raw keys never leak through logs. Only `redactKey()` output is
// emitted. Non-Darwin callers get a silent no-op (no `security` invocation).
// ---------------------------------------------------------------------------

import * as nodeFs from "node:fs";
import * as nodeChildProcess from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { PROVIDERS, type ProviderId } from "./providers.js";
import { redactKey, saveKey } from "./settings-store.js";

export const DEFAULT_GRACE_PERIOD_DAYS = 30;

export interface MigrationState {
  acknowledged: boolean;
  ackedAt: string | null;
  migratedAt: string | null;
}

export interface MigrationAvailability {
  hasLegacyKeys: boolean;
  providers: ProviderId[];
  ackStatus?: {
    acknowledged: boolean;
    ackedAt: string | null;
    migratedAt: string | null;
  };
}

export interface MigrationResult {
  migrated: ProviderId[];
}

interface Logger {
  warn: (msg: string) => void;
  error: (msg: string) => void;
  info?: (msg: string) => void;
}

type SpawnSyncLike = (
  cmd: string,
  args: ReadonlyArray<string>,
) => {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
};

export interface MigratorOptions {
  /** Override for tests — defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Override for tests — defaults to `child_process.spawnSync`. */
  spawnSync?: SpawnSyncLike;
  /** Where to persist the migration-state file. Defaults to `~/.vskill/migration-state.json`. */
  statePath?: string;
  /** Custom logger (tests). Defaults to console. */
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// State file helpers — exported for test fixtures + the api-routes handler.
// ---------------------------------------------------------------------------

function defaultStatePath(): string {
  const base =
    process.env.VSKILL_CONFIG_DIR && process.env.VSKILL_CONFIG_DIR.length > 0
      ? process.env.VSKILL_CONFIG_DIR
      : path.join(os.homedir(), ".vskill");
  return path.join(base, "migration-state.json");
}

export function readMigrationState(filePath: string): MigrationState | null {
  if (!nodeFs.existsSync(filePath)) return null;
  try {
    const raw = nodeFs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MigrationState>;
    return {
      acknowledged: parsed.acknowledged === true,
      ackedAt: typeof parsed.ackedAt === "string" ? parsed.ackedAt : null,
      migratedAt: typeof parsed.migratedAt === "string" ? parsed.migratedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeMigrationState(filePath: string, state: MigrationState): void {
  nodeFs.mkdirSync(path.dirname(filePath), { recursive: true });
  nodeFs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Service name mapping — matches the pre-0702 keychain convention
// `vskill-<provider>` with account `vskill-user`.
// ---------------------------------------------------------------------------

function keychainService(provider: ProviderId): string {
  return `vskill-${provider}`;
}

const KEYCHAIN_ACCOUNT = "vskill-user";

// ---------------------------------------------------------------------------
// Migrator
// ---------------------------------------------------------------------------

const defaultLogger: Logger = {
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  info: (m) => console.log(m),
};

export class DarwinKeychainMigrator {
  private readonly platform: NodeJS.Platform;
  private readonly spawnSync: SpawnSyncLike;
  private readonly statePath: string;
  private readonly logger: Logger;

  constructor(opts: MigratorOptions = {}) {
    this.platform = opts.platform ?? process.platform;
    this.spawnSync = opts.spawnSync ?? nodeChildProcess.spawnSync;
    this.statePath = opts.statePath ?? defaultStatePath();
    this.logger = opts.logger ?? defaultLogger;
  }

  /** Probe the keychain for legacy entries. Never writes; never errors on non-Darwin. */
  async available(): Promise<MigrationAvailability> {
    const state = readMigrationState(this.statePath);
    if (this.platform !== "darwin") {
      return {
        hasLegacyKeys: false,
        providers: [],
        ackStatus: state
          ? { acknowledged: state.acknowledged, ackedAt: state.ackedAt, migratedAt: state.migratedAt }
          : undefined,
      };
    }

    const found: ProviderId[] = [];
    for (const p of PROVIDERS) {
      const raw = this.probe(p.id);
      if (raw !== null) found.push(p.id);
    }

    return {
      hasLegacyKeys: found.length > 0,
      providers: found,
      ackStatus: state
        ? { acknowledged: state.acknowledged, ackedAt: state.ackedAt, migratedAt: state.migratedAt }
        : undefined,
    };
  }

  /** Copy legacy keychain entries into the file store. Idempotent. */
  async migrate(): Promise<MigrationResult> {
    if (this.platform !== "darwin") return { migrated: [] };

    const state = readMigrationState(this.statePath);
    if (state && state.migratedAt) {
      // Already migrated — honor idempotency.
      return { migrated: [] };
    }

    const migrated: ProviderId[] = [];
    for (const p of PROVIDERS) {
      const raw = this.probe(p.id);
      if (raw === null) continue;
      try {
        await saveKey(p.id, raw);
        migrated.push(p.id);
        this.logger.info?.(
          `[darwin-migrator] migrated ${p.id} (${redactKey(raw)}) from keychain`,
        );
      } catch (err) {
        this.logger.error(
          `[darwin-migrator] failed to migrate ${p.id}: ${(err as Error).message}`,
        );
      }
    }

    writeMigrationState(this.statePath, {
      acknowledged: false,
      ackedAt: null,
      migratedAt: new Date().toISOString(),
    });

    return { migrated };
  }

  /** Record that the user dismissed the migration banner. */
  async acknowledge(): Promise<void> {
    const prev = readMigrationState(this.statePath);
    writeMigrationState(this.statePath, {
      acknowledged: true,
      ackedAt: new Date().toISOString(),
      migratedAt: prev?.migratedAt ?? null,
    });
  }

  /** Read a single keychain entry via `security find-generic-password`. */
  private probe(provider: ProviderId): string | null {
    const args = [
      "find-generic-password",
      "-s",
      keychainService(provider),
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ];
    let result;
    try {
      result = this.spawnSync("security", args);
    } catch (err) {
      this.logger.warn(
        `[darwin-migrator] security spawn failed for ${provider}: ${(err as Error).message}`,
      );
      return null;
    }
    if (result.status !== 0) return null;
    const stdout =
      typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  }
}
