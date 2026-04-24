// ---------------------------------------------------------------------------
// log-capture.test.ts — T-070 (0702 Phase 2).
//
// Full-pipeline security contract: across every path that touches a raw API
// key (save / read / merge / remove / migrate / serialize-error), the raw
// value must NEVER appear in any captured log output.
//
// Instead of asserting on individual log call sites, this test injects a
// recording logger into every module that logs, exercises each code path
// with a canary-bearing key, and greps the entire captured stream for the
// canary substring.
//
// Canary: "LEAKCANARY4242" — unique enough to detect any accidental echo.
// If this test ever fails, treat it as a P0 data-exfil risk.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as store from "../settings-store.js";
import { DarwinKeychainMigrator, writeMigrationState } from "../darwin-migrator.js";

const CANARY = "LEAKCANARY4242";

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-logcap-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("log-capture security sweep (T-070)", () => {
  let tmp: string;
  const capturedLogs: string[] = [];
  const envSnapshot: Record<string, string | undefined> = {};

  const recordingLogger = {
    warn: (m: string) => capturedLogs.push(`WARN ${m}`),
    error: (m: string) => capturedLogs.push(`ERROR ${m}`),
    info: (m: string) => capturedLogs.push(`INFO ${m}`),
  };

  beforeEach(() => {
    tmp = makeTmp();
    capturedLogs.length = 0;
    envSnapshot.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    envSnapshot.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    envSnapshot.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    envSnapshot.VSKILL_CONFIG_DIR = process.env.VSKILL_CONFIG_DIR;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.VSKILL_CONFIG_DIR = tmp;
    store.resetSettingsStore({ configDir: tmp, logger: recordingLogger });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("save → list → read → merge paths never echo raw key", async () => {
    const rawKey = `sk-ant-${CANARY}-zzzzzzzz`;
    await store.saveKey("anthropic", rawKey);
    const meta = store.listKeys();
    expect(meta.anthropic.stored).toBe(true);
    // listKeys metadata itself must not contain the key.
    expect(JSON.stringify(meta)).not.toContain(CANARY);
    // Read returns the raw key (intentionally — callers use it to auth).
    // But the read codepath itself must not log the raw value.
    const readBack = store.readKey("anthropic");
    expect(readBack).toBe(rawKey);
    // Merge into env (clears in-memory map).
    store.mergeStoredKeysIntoEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe(rawKey);
    // Sweep captured logs.
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("save-error path redacts the key in the error message and logs", async () => {
    // Force a write error by pointing the store at a directory path the
    // user cannot write to. We do this by clobbering the keys file path
    // with a directory (mkdir where the tmp file would go).
    const rawKey = `sk-ant-${CANARY}-errorpath`;
    // Pre-create the keys.env *as a directory* to force rename to fail.
    const keysFile = store.getKeysFilePath();
    fs.mkdirSync(keysFile, { recursive: true });
    let errMsg = "";
    try {
      await store.saveKey("anthropic", rawKey);
    } catch (e) {
      errMsg = (e as Error).message;
    }
    expect(errMsg).not.toBe("");
    // Error message must redact the raw key.
    expect(errMsg).not.toContain(CANARY);
    // Captured logs must not contain the raw key either.
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("remove path never echoes raw key", async () => {
    const rawKey = `sk-or-${CANARY}-removepath`;
    await store.saveKey("openrouter", rawKey);
    await store.removeKey("openrouter");
    expect(store.readKey("openrouter")).toBeNull();
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("redactKey() emits only ****<last-4> form", () => {
    const rawKey = `sk-ant-${CANARY}-tail9999`;
    const redacted = store.redactKey(rawKey);
    expect(redacted).not.toContain(CANARY);
    expect(redacted).toMatch(/\*+9999$/);
  });

  it("darwin-migrator migrate path never echoes raw keychain values", async () => {
    const statePath = path.join(tmp, "migration-state.json");
    const rawKey = `sk-ant-${CANARY}-keychain`;
    // Stub spawnSync to simulate a Darwin keychain returning the canary key.
    const spawn = (_cmd: string, args: ReadonlyArray<string>) => {
      const sIdx = args.indexOf("-s");
      const svc = sIdx >= 0 ? args[sIdx + 1] : "";
      if (svc === "vskill-anthropic") {
        return { status: 0, stdout: rawKey + "\n", stderr: "" };
      }
      return { status: 44, stdout: "", stderr: "not found" };
    };
    const migrator = new DarwinKeychainMigrator({
      platform: "darwin",
      spawnSync: spawn,
      statePath,
      logger: recordingLogger,
    });
    const availability = await migrator.available();
    expect(availability.providers).toContain("anthropic");
    const result = await migrator.migrate();
    expect(result.migrated).toContain("anthropic");
    // The migrated key is now in the store.
    expect(store.readKey("anthropic")).toBe(rawKey);
    // But no log line should contain the raw key.
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("darwin-migrator acknowledge path never writes raw keys", async () => {
    const statePath = path.join(tmp, "migration-state.json");
    writeMigrationState(statePath, {
      acknowledged: false,
      ackedAt: null,
      migratedAt: "2026-04-01T00:00:00.000Z",
    });
    const migrator = new DarwinKeychainMigrator({
      platform: "darwin",
      spawnSync: () => ({ status: 44, stdout: "", stderr: "" }),
      statePath,
      logger: recordingLogger,
    });
    await migrator.acknowledge();
    // State file content must never contain a raw key (we never wrote one,
    // but belt-and-suspenders: check the file explicitly).
    const stateContent = fs.readFileSync(statePath, "utf8");
    expect(stateContent).not.toContain(CANARY);
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });

  it("malformed keys.env warning never echoes raw values", async () => {
    // Write garbage into keys.env to trigger the parse warning path.
    const keysFile = store.getKeysFilePath();
    fs.mkdirSync(path.dirname(keysFile), { recursive: true });
    // Include the canary as a garbage line — parser must skip it without logging.
    const garbage = [
      "not-a-key-line",
      `INVALID_LINE_${CANARY}`,
      "",
      "=value-no-key",
    ].join("\n");
    fs.writeFileSync(keysFile, garbage, { mode: 0o600 });
    // Re-init the store so it re-reads the file with our recording logger.
    store.resetSettingsStore({ configDir: tmp, logger: recordingLogger });
    // Trigger a load via listKeys (calls loadIfNeeded internally).
    store.listKeys();
    for (const line of capturedLogs) {
      expect(line).not.toContain(CANARY);
    }
  });
});
