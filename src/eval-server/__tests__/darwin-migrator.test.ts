// ---------------------------------------------------------------------------
// darwin-migrator.test.ts — T-060 (0702 Phase 2).
//
// Contract for `DarwinKeychainMigrator`:
//   - available({platform, spawnSync?}): returns { hasLegacyKeys, providers, ackStatus }
//     * On non-Darwin platforms: returns { hasLegacyKeys: false, providers: [] }
//       and does NOT spawn any child process.
//     * On Darwin: probes `security find-generic-password -s vskill-<provider>
//       -a vskill-user -w` for each PROVIDERS entry. Found → providers list.
//   - migrate({store, platform, spawnSync?}): copies keychain values into store,
//     writes migration-state.json with ackedAt=null, migratedAt=now.
//     Idempotent: second call with migratedAt already set is a no-op.
//   - acknowledge({statePath}): sets ackedAt to now in the state file.
//   - Logs only redactKey output — raw values never appear.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DarwinKeychainMigrator,
  readMigrationState,
  writeMigrationState,
  DEFAULT_GRACE_PERIOD_DAYS,
} from "../darwin-migrator.js";
import * as store from "../settings-store.js";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-migrator-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// Build a spawnSync-compatible stub that emits canned stdout/exitCode per
// keychain `-s` tag. Any tag not in the map produces exit 44 (keychain "not
// found"), matching `security`'s real behavior.
type SpawnLike = (
  cmd: string,
  args: ReadonlyArray<string>,
) => { status: number | null; stdout: string | Buffer; stderr: string | Buffer };

function makeSpawn(serviceToKey: Record<string, string>): SpawnLike {
  return (_cmd, args) => {
    const sIdx = args.indexOf("-s");
    const service = sIdx >= 0 ? args[sIdx + 1] : "";
    const found = serviceToKey[service];
    if (found) {
      return { status: 0, stdout: found + "\n", stderr: "" };
    }
    return { status: 44, stdout: "", stderr: "security: could not be found" };
  };
}

describe("DarwinKeychainMigrator (T-060)", () => {
  let tmp: string;
  let statePath: string;
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = makeTmp();
    statePath = path.join(tmp, "migration-state.json");
    envSnapshot.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    envSnapshot.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    envSnapshot.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    store.resetSettingsStore({ configDir: tmp });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    store.resetSettingsStore();
    cleanup(tmp);
  });

  // ---- available() ----

  it("TC-036: non-Darwin platform → hasLegacyKeys=false, no spawn calls", async () => {
    let spawnCalls = 0;
    const spawn: SpawnLike = (..._args) => {
      spawnCalls++;
      return { status: 0, stdout: "", stderr: "" };
    };
    const migrator = new DarwinKeychainMigrator({ platform: "linux", spawnSync: spawn, statePath });
    const result = await migrator.available();
    expect(result.hasLegacyKeys).toBe(false);
    expect(result.providers).toEqual([]);
    expect(spawnCalls).toBe(0);
  });

  it("TC-034: Darwin with both anthropic+openrouter entries → providers list has both", async () => {
    const spawn = makeSpawn({
      "vskill-anthropic": "sk-ant-legacy-aaaa",
      "vskill-openrouter": "sk-or-legacy-bbbb",
    });
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: spawn, statePath });
    const result = await migrator.available();
    expect(result.hasLegacyKeys).toBe(true);
    expect(result.providers.sort()).toEqual(["anthropic", "openrouter"]);
  });

  it("Darwin with only anthropic → providers list is exactly [anthropic]", async () => {
    const spawn = makeSpawn({ "vskill-anthropic": "sk-ant-only" });
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: spawn, statePath });
    const result = await migrator.available();
    expect(result.hasLegacyKeys).toBe(true);
    expect(result.providers).toEqual(["anthropic"]);
  });

  it("Darwin with no entries → hasLegacyKeys=false", async () => {
    const spawn = makeSpawn({});
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: spawn, statePath });
    const result = await migrator.available();
    expect(result.hasLegacyKeys).toBe(false);
    expect(result.providers).toEqual([]);
  });

  // ---- migrate() ----

  it("migrate() copies keychain values into store and writes state file", async () => {
    const spawn = makeSpawn({
      "vskill-anthropic": "sk-ant-mig-ccc",
      "vskill-openrouter": "sk-or-mig-ddd",
    });
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: spawn, statePath });
    const result = await migrator.migrate();
    expect(result.migrated.sort()).toEqual(["anthropic", "openrouter"]);
    // Store now reads the migrated values.
    expect(store.readKey("anthropic")).toBe("sk-ant-mig-ccc");
    expect(store.readKey("openrouter")).toBe("sk-or-mig-ddd");
    // State file is present with migratedAt set.
    const state = readMigrationState(statePath);
    expect(state).not.toBeNull();
    expect(state!.migratedAt).not.toBeNull();
    expect(state!.acknowledged).toBe(false);
    expect(state!.ackedAt).toBeNull();
  });

  it("TC-035: migrate() is idempotent — state file present → no spawn, no store write", async () => {
    writeMigrationState(statePath, {
      acknowledged: false,
      ackedAt: null,
      migratedAt: "2026-04-01T00:00:00.000Z",
    });
    let spawnCalls = 0;
    const spawn: SpawnLike = (..._args) => {
      spawnCalls++;
      return { status: 0, stdout: "sk-ant-fresh\n", stderr: "" };
    };
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: spawn, statePath });
    const result = await migrator.migrate();
    expect(result.migrated).toEqual([]);
    expect(spawnCalls).toBe(0);
    // Store unchanged.
    expect(store.readKey("anthropic")).toBeNull();
  });

  it("non-Darwin platform → migrate() is a no-op", async () => {
    let spawnCalls = 0;
    const spawn: SpawnLike = () => {
      spawnCalls++;
      return { status: 0, stdout: "", stderr: "" };
    };
    const migrator = new DarwinKeychainMigrator({ platform: "win32", spawnSync: spawn, statePath });
    const result = await migrator.migrate();
    expect(result.migrated).toEqual([]);
    expect(spawnCalls).toBe(0);
    expect(fs.existsSync(statePath)).toBe(false);
  });

  // ---- acknowledge() ----

  it("acknowledge() sets ackedAt to ISO timestamp and acknowledged=true", async () => {
    writeMigrationState(statePath, {
      acknowledged: false,
      ackedAt: null,
      migratedAt: "2026-04-01T00:00:00.000Z",
    });
    const migrator = new DarwinKeychainMigrator({ platform: "darwin", spawnSync: makeSpawn({}), statePath });
    await migrator.acknowledge();
    const state = readMigrationState(statePath);
    expect(state!.acknowledged).toBe(true);
    expect(state!.ackedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ---- redaction ----

  it("available() + migrate() never emit raw keys into logs", async () => {
    const captured: string[] = [];
    const logger = {
      warn: (m: string) => captured.push(m),
      error: (m: string) => captured.push(m),
      info: (m: string) => captured.push(m),
    };
    const CANARY = "KEYCHAINCANARY9Z";
    const spawn = makeSpawn({
      "vskill-anthropic": `sk-ant-${CANARY}-raw`,
    });
    const migrator = new DarwinKeychainMigrator({
      platform: "darwin",
      spawnSync: spawn,
      statePath,
      logger,
    });
    await migrator.available();
    await migrator.migrate();
    for (const line of captured) {
      expect(line).not.toContain(CANARY);
    }
  });

  // ---- grace period constant exported ----

  it("DEFAULT_GRACE_PERIOD_DAYS is 30 days", () => {
    expect(DEFAULT_GRACE_PERIOD_DAYS).toBe(30);
  });
});
