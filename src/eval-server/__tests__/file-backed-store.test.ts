// ---------------------------------------------------------------------------
// file-backed-store.test.ts — Phase 1 TDD for the new FileBackedStore.
//
// Covers: T-001 (core ops), T-002 (atomic-write failure), T-003 (chmod 0600),
// T-004 (lenient parser), T-005 (redacted logging).
//
// Tests use real temp dirs (mkdtempSync) — no in-memory fakes. Injected DI
// (logger, fs, configDir) via resetSettingsStore({...}) for failure paths.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../settings-store.js";

const UNIQUE = "UNIQUESUB9X";
const KEY_WITH_CANARY = `sk-ant-${UNIQUE}-tail2020`;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-test-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("FileBackedStore — core operations (T-001)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    store.resetSettingsStore({ configDir: tmp });
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("TC-001: saveKey persists, new store reads same dir", async () => {
    await store.saveKey("anthropic", "sk-ant-persist-xxx");
    // Simulate fresh process: reset in-memory state but keep on-disk file.
    store.resetSettingsStore({ configDir: tmp });
    expect(store.readKey("anthropic")).toBe("sk-ant-persist-xxx");
  });

  it("TC-002: readKey returns null for missing provider", () => {
    expect(store.readKey("openai")).toBe(null);
    expect(store.readKey("openrouter")).toBe(null);
  });

  it("TC-003: removeKey is idempotent", async () => {
    await store.saveKey("anthropic", "sk-ant-rm-xxx");
    await store.removeKey("anthropic");
    expect(store.readKey("anthropic")).toBe(null);
    // Second call must not throw.
    await expect(store.removeKey("anthropic")).resolves.toBeUndefined();
  });

  it("TC-004: listKeys reports all three providers with updatedAt", async () => {
    await store.saveKey("anthropic", "sk-ant-abc1111");
    await store.saveKey("openai", "sk-proj-def2222");
    await store.saveKey("openrouter", "sk-or-ghi3333");
    const list = store.listKeys();
    expect(list.anthropic.stored).toBe(true);
    expect(list.openai.stored).toBe(true);
    expect(list.openrouter.stored).toBe(true);
    expect(list.anthropic.updatedAt).toBeTruthy();
    expect(list.openai.updatedAt).toBeTruthy();
    expect(list.openrouter.updatedAt).toBeTruthy();
    // tier field must NOT appear on the metadata.
    expect((list.anthropic as Record<string, unknown>).tier).toBeUndefined();
  });

  it("VSKILL_CONFIG_DIR override resolves correctly", () => {
    const filePath = store.getKeysFilePath();
    expect(filePath).toBe(path.join(tmp, "keys.env"));
  });

  it("readKey returns stored value after saveKey (same-process)", async () => {
    await store.saveKey("anthropic", "sk-ant-same-xxx");
    expect(store.readKey("anthropic")).toBe("sk-ant-same-xxx");
  });
});

describe("FileBackedStore — atomic-write (T-002)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("TC-005: rename failure → no .tmp leftover, original untouched, no raw key in error", async () => {
    // Seed an existing valid keys.env so we can assert it's untouched.
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(keysFile, "ANTHROPIC_API_KEY=old-key-preserved\n");

    // Build a fs facade that passes through to real fs for everything except
    // renameSync, which throws. writeFileSync + chmodSync must still work so
    // the tmp file gets created (and then must be cleaned up on failure).
    const realFs = {
      writeFileSync: fs.writeFileSync,
      renameSync: (_src: string, _dest: string) => {
        throw new Error("simulated rename failure");
      },
      chmodSync: fs.chmodSync,
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
      unlinkSync: fs.unlinkSync,
      mkdirSync: fs.mkdirSync,
      statSync: fs.statSync,
    };

    store.resetSettingsStore({ configDir: tmp, fs: realFs as never });

    await expect(
      store.saveKey("anthropic", KEY_WITH_CANARY),
    ).rejects.toThrow();

    // Original file unchanged.
    const after = fs.readFileSync(keysFile, "utf8");
    expect(after).toContain("old-key-preserved");

    // No .tmp leftover files.
    const entries = fs.readdirSync(tmp);
    const tmpLeftovers = entries.filter((e) => e.endsWith(".tmp") || e.includes("keys.env."));
    expect(tmpLeftovers).toEqual([]);
  });

  it("TC-005b: rename failure error message never contains the raw key", async () => {
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(keysFile, "");

    const realFs = {
      writeFileSync: fs.writeFileSync,
      renameSync: () => {
        throw new Error("simulated rename failure");
      },
      chmodSync: fs.chmodSync,
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
      unlinkSync: fs.unlinkSync,
      mkdirSync: fs.mkdirSync,
      statSync: fs.statSync,
    };

    const warns: string[] = [];
    const errors: string[] = [];
    store.resetSettingsStore({
      configDir: tmp,
      fs: realFs as never,
      logger: {
        warn: (m: string) => warns.push(m),
        error: (m: string) => errors.push(m),
      },
    });

    try {
      await store.saveKey("anthropic", KEY_WITH_CANARY);
    } catch (err) {
      expect((err as Error).message).not.toContain(UNIQUE);
    }

    for (const line of [...warns, ...errors]) {
      expect(line).not.toContain(UNIQUE);
    }
  });
});

describe.skipIf(process.platform === "win32")(
  "FileBackedStore — POSIX chmod 0600 (T-003)",
  () => {
    let tmp: string;
    let prevUmask: number;

    beforeEach(() => {
      tmp = makeTmpDir();
      prevUmask = process.umask(0o022);
      store.resetSettingsStore({ configDir: tmp });
    });

    afterEach(() => {
      process.umask(prevUmask);
      store.resetSettingsStore();
      cleanup(tmp);
    });

    it("TC-006: keys.env written with mode 0600 even under umask 0022", async () => {
      await store.saveKey("anthropic", "sk-ant-chmod-xxx");
      const keysFile = path.join(tmp, "keys.env");
      const stat = fs.statSync(keysFile);
      // eslint-disable-next-line no-bitwise
      expect(stat.mode & 0o777).toBe(0o600);
    });
  },
);

describe("FileBackedStore — lenient parser (T-004)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("TC-007: mixed valid/invalid lines: no throw, valid keys readable, exactly 1 warning", () => {
    const keysFile = path.join(tmp, "keys.env");
    // BOM + valid + blank + malformed + whitespace + valid
    const contents =
      "\uFEFF" +
      "ANTHROPIC_API_KEY=sk-ant-valid-1\n" +
      "\n" +
      "NOT_A_KEY_FORMAT\n" +
      "   \n" +
      "OPENAI_API_KEY=sk-proj-valid-2\n" +
      "= \n";
    fs.writeFileSync(keysFile, contents);

    const warns: string[] = [];
    const errors: string[] = [];
    expect(() =>
      store.resetSettingsStore({
        configDir: tmp,
        logger: {
          warn: (m: string) => warns.push(m),
          error: (m: string) => errors.push(m),
        },
      }),
    ).not.toThrow();

    expect(store.readKey("anthropic")).toBe("sk-ant-valid-1");
    expect(store.readKey("openai")).toBe("sk-proj-valid-2");
    // Exactly one aggregated warning.
    expect(warns.length).toBe(1);
  });
});

describe("FileBackedStore — post-merge listKeys retention (T-071 DEFECT 1)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    // Clear any process.env provider vars to isolate the test.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    store.resetSettingsStore();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    cleanup(tmp);
  });

  it("TC-071a: listKeys reports stored:true for all providers after mergeStoredKeysIntoEnv()", async () => {
    // Seed an on-disk keys.env with two providers (simulating post-restart boot).
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      keysFile,
      "ANTHROPIC_API_KEY=sk-ant-persist-post-restart\n" +
        "OPENAI_API_KEY=sk-proj-persist-post-restart\n",
    );

    // Fresh boot: new store, merge, then listKeys (exactly the flow boot takes).
    store.resetSettingsStore({ configDir: tmp });
    store.mergeStoredKeysIntoEnv();

    const list = store.listKeys();
    expect(list.anthropic.stored).toBe(true);
    expect(list.openai.stored).toBe(true);
    expect(list.openrouter.stored).toBe(false); // not on disk
    expect(list.anthropic.updatedAt).toBeTruthy();
    expect(list.openai.updatedAt).toBeTruthy();
    expect(list.openrouter.updatedAt).toBe(null);
  });

  it("TC-071b: saveKey after mergeStoredKeysIntoEnv() still shows up in listKeys", async () => {
    // First: seed on-disk, merge, confirm listKeys finds it.
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(keysFile, "ANTHROPIC_API_KEY=sk-ant-already-stored\n");
    store.resetSettingsStore({ configDir: tmp });
    store.mergeStoredKeysIntoEnv();

    // Now save a NEW provider after the merge has happened.
    await store.saveKey("openrouter", "sk-or-saved-post-merge");

    const list = store.listKeys();
    expect(list.anthropic.stored).toBe(true);
    expect(list.openrouter.stored).toBe(true);
    expect(list.openrouter.updatedAt).toBeTruthy();
  });

  it("0682 F-002: removeKey preserves real env vars set by the operator's shell", async () => {
    // Simulate the scenario:
    //   1. Operator exports ANTHROPIC_API_KEY=sk-ant-real in their shell
    //      (this is the "real" env var, never touches the file store).
    //   2. User saves a DIFFERENT provider via Settings (file store gains
    //      one entry — say openai). mergeStoredKeysIntoEnv runs at boot.
    //   3. User clicks Remove on the openai entry.
    //   4. The real ANTHROPIC_API_KEY in process.env MUST survive — it
    //      belongs to the operator's environment, not the file store.
    process.env.ANTHROPIC_API_KEY = "sk-ant-real-from-shell";
    store.resetSettingsStore({ configDir: tmp });
    await store.saveKey("openai", "sk-proj-stored-only");
    store.mergeStoredKeysIntoEnv();
    // Confirm preconditions: file-store key landed in env, real env var unchanged.
    expect(process.env.OPENAI_API_KEY).toBe("sk-proj-stored-only");
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-real-from-shell");

    await store.removeKey("openai");
    // file-store-derived env var cleared:
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    // real env var preserved:
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-real-from-shell");
  });

  it("TC-071c: removeKey after mergeStoredKeysIntoEnv() flips listKeys to stored:false", async () => {
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(keysFile, "ANTHROPIC_API_KEY=sk-ant-to-remove\n");
    store.resetSettingsStore({ configDir: tmp });
    store.mergeStoredKeysIntoEnv();

    // Confirm merged state reports stored:true.
    expect(store.listKeys().anthropic.stored).toBe(true);

    // Remove via public API.
    await store.removeKey("anthropic");

    // listKeys must now report stored:false.
    expect(store.listKeys().anthropic.stored).toBe(false);
    expect(store.listKeys().anthropic.updatedAt).toBe(null);
  });

  it("TC-071d: security invariant — raw plaintext NOT retained in settings-store memory after merge", async () => {
    // After merge, the in-memory structure must not contain plaintext keys.
    // We verify this by stringifying whatever state we can observe: readKey()
    // should resolve from process.env, not from a retained raw-key map.
    const rawKey = "sk-ant-CANARY-DWELL-XYZ-plaintext";
    const keysFile = path.join(tmp, "keys.env");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(keysFile, `ANTHROPIC_API_KEY=${rawKey}\n`);
    store.resetSettingsStore({ configDir: tmp });
    store.mergeStoredKeysIntoEnv();

    // Remove the env var — if raw plaintext were still in memory, readKey
    // would return it. After merge-then-env-clear, readKey must return null.
    delete process.env.ANTHROPIC_API_KEY;
    expect(store.readKey("anthropic")).toBe(null);
    // But listKeys still reports stored:true (metadata retained).
    expect(store.listKeys().anthropic.stored).toBe(true);
  });
});

describe("FileBackedStore — redacted logging (T-005)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("TC-008: no log line contains raw key across all paths", async () => {
    const warns: string[] = [];
    const errors: string[] = [];

    // Phase A: successful save path
    store.resetSettingsStore({
      configDir: tmp,
      logger: {
        warn: (m: string) => warns.push(m),
        error: (m: string) => errors.push(m),
      },
    });
    await store.saveKey("anthropic", KEY_WITH_CANARY);
    await store.readKey("anthropic");
    await store.removeKey("anthropic");
    // Second remove (missing) — exercises idempotent no-op path.
    await store.removeKey("anthropic");

    // Phase B: rename-failure path
    const rejectingFs = {
      writeFileSync: fs.writeFileSync,
      renameSync: () => {
        throw new Error("simulated rename failure");
      },
      chmodSync: fs.chmodSync,
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
      unlinkSync: fs.unlinkSync,
      mkdirSync: fs.mkdirSync,
      statSync: fs.statSync,
    };
    store.resetSettingsStore({
      configDir: tmp,
      fs: rejectingFs as never,
      logger: {
        warn: (m: string) => warns.push(m),
        error: (m: string) => errors.push(m),
      },
    });
    await expect(store.saveKey("anthropic", KEY_WITH_CANARY)).rejects.toThrow();

    // Phase C: parse-warning path (malformed file)
    const keysFile = path.join(tmp, "keys.env");
    fs.writeFileSync(keysFile, `GARBAGE_LINE_WITH_${UNIQUE}_NOT_A_PROVIDER\n`);
    store.resetSettingsStore({
      configDir: tmp,
      logger: {
        warn: (m: string) => warns.push(m),
        error: (m: string) => errors.push(m),
      },
    });

    // Parser must NOT include the garbage line content verbatim — redaction or omission required.
    for (const line of [...warns, ...errors]) {
      expect(line).not.toContain(UNIQUE);
    }
  });
});
