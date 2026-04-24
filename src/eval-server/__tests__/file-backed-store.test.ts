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
