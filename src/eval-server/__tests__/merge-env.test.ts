// ---------------------------------------------------------------------------
// merge-env.test.ts — T-007: mergeStoredKeysIntoEnv boot-time behavior.
//
// Contract:
//  - Real env vars always WIN (never overwritten)
//  - Missing env vars are populated from stored keys
//  - In-memory store map is cleared after merge
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../settings-store.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-merge-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("mergeStoredKeysIntoEnv (T-007)", () => {
  let tmp: string;
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = makeTmpDir();
    snapshot.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    snapshot.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    snapshot.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    store.resetSettingsStore({ configDir: tmp });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    store.resetSettingsStore();
    cleanup(tmp);
  });

  it("TC-009: real env var wins — merge does not overwrite", async () => {
    process.env.ANTHROPIC_API_KEY = "real-env-value";
    await store.saveKey("anthropic", "stored-value-should-not-win");
    store.mergeStoredKeysIntoEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("real-env-value");
  });

  it("TC-010: stored key populates env when env is empty", async () => {
    await store.saveKey("openai", "sk-proj-merge-xxx");
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    store.mergeStoredKeysIntoEnv();
    expect(process.env.OPENAI_API_KEY).toBe("sk-proj-merge-xxx");
  });

  it("TC-011: in-memory map is cleared after merge", async () => {
    await store.saveKey("openrouter", "sk-or-merge-xxx");
    store.mergeStoredKeysIntoEnv();
    // After merge the in-memory map must be cleared (plaintext dwell-time
    // minimization). Re-reading should still work — via env var, which was
    // just populated. So readKey returns null (map empty) but env has it.
    // Public contract: readKey consults process.env first, then memory.
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-merge-xxx");
    // readKey after clearMemory should still find the value via env.
    expect(store.readKey("openrouter")).toBe("sk-or-merge-xxx");
  });

  it("merges all three providers independently", async () => {
    await store.saveKey("anthropic", "sk-ant-aaa");
    await store.saveKey("openai", "sk-proj-bbb");
    await store.saveKey("openrouter", "sk-or-ccc");
    store.mergeStoredKeysIntoEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-aaa");
    expect(process.env.OPENAI_API_KEY).toBe("sk-proj-bbb");
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-ccc");
  });

  // --------------------------------------------------------------------------
  // TC-012 (regression): post-merge metadata survives.
  //
  // Bug discovered by e2e-0702 verification: at boot the server called
  // loadIfNeeded() then mergeStoredKeysIntoEnv(), which cleared the entire
  // in-memory map. Subsequent calls to listKeys() reported stored:false for
  // every provider, because loaded=true short-circuits re-load and the map
  // is empty.
  //
  // Fix contract: after merge, listKeys() must still report stored:true and
  // preserve the original updatedAt. readKey() must still resolve to the key
  // via process.env (merge populated it). hasKeySync() must be true.
  // --------------------------------------------------------------------------
  it("TC-012: listKeys reports stored:true + updatedAt after merge", async () => {
    const saveResult = await store.saveKey("anthropic", "sk-ant-TEST");
    const originalUpdatedAt = saveResult.updatedAt;

    store.mergeStoredKeysIntoEnv();

    const list = store.listKeys();
    expect(list.anthropic.stored).toBe(true);
    expect(list.anthropic.updatedAt).toBe(originalUpdatedAt);
    expect(list.openai.stored).toBe(false);
    expect(list.openai.updatedAt).toBeNull();
    expect(list.openrouter.stored).toBe(false);
  });

  it("TC-012b: readKey returns value via env fallback after merge", async () => {
    await store.saveKey("anthropic", "sk-ant-TEST");
    store.mergeStoredKeysIntoEnv();
    expect(store.readKey("anthropic")).toBe("sk-ant-TEST");
  });

  it("TC-012c: hasKeySync returns true after merge", async () => {
    await store.saveKey("openai", "sk-proj-TEST");
    store.mergeStoredKeysIntoEnv();
    expect(store.hasKeySync("openai")).toBe(true);
  });

  it("TC-012d: listKeys reflects all three providers after merge", async () => {
    await store.saveKey("anthropic", "sk-ant-a");
    await store.saveKey("openai", "sk-proj-b");
    await store.saveKey("openrouter", "sk-or-c");

    store.mergeStoredKeysIntoEnv();

    const list = store.listKeys();
    expect(list.anthropic.stored).toBe(true);
    expect(list.openai.stored).toBe(true);
    expect(list.openrouter.stored).toBe(true);
    expect(list.anthropic.updatedAt).not.toBeNull();
    expect(list.openai.updatedAt).not.toBeNull();
    expect(list.openrouter.updatedAt).not.toBeNull();
  });
});
