import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../settings-store";

function makeFakeSpawn(exitCode = 0) {
  const emitter = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  (emitter as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  (emitter as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawnFn = vi.fn((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    queueMicrotask(() => {
      emitter.emit("close", exitCode);
    });
    return emitter as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawnFn, calls };
}

describe("settings-store", () => {
  beforeEach(() => {
    store.resetSettingsStore();
  });

  afterEach(() => {
    store.resetSettingsStore();
  });

  describe("redactKey", () => {
    it("returns ****<last-4>", () => {
      expect(store.redactKey("sk-ant-abcd1234")).toBe("****1234");
    });
    it("collapses short keys to ****", () => {
      expect(store.redactKey("1234")).toBe("****");
      expect(store.redactKey("")).toBe("****");
    });
  });

  describe("setTier", () => {
    it("succeeds silently on Darwin for keychain tier", async () => {
      store._setPlatformOverride("darwin");
      await expect(store.setTier("keychain")).resolves.toBeUndefined();
      expect(store.getTier()).toBe("keychain");
    });

    it("throws UnsupportedTierError on non-Darwin for keychain tier", async () => {
      store._setPlatformOverride("linux");
      await expect(store.setTier("keychain")).rejects.toBeInstanceOf(
        store.UnsupportedTierError,
      );
    });
  });

  describe("saveKey / readKey / removeKey", () => {
    it("stores in browser tier and round-trips", async () => {
      const saved = await store.saveKey("anthropic", "sk-ant-test-1234", "browser");
      expect(saved.tier).toBe("browser");
      expect(store.readKey("anthropic")).toBe("sk-ant-test-1234");
      const list = store.listKeys();
      expect(list.anthropic.stored).toBe(true);
      expect(list.anthropic.tier).toBe("browser");
      expect(list.openrouter.stored).toBe(false);
    });

    it("stores in Darwin keychain via security CLI with key via -w", async () => {
      store._setPlatformOverride("darwin");
      const { spawnFn, calls } = makeFakeSpawn(0);
      store._setSpawn(spawnFn);
      await store.saveKey("anthropic", "sk-ant-test-1234", "keychain");
      expect(calls.length).toBe(1);
      expect(calls[0].cmd).toBe("security");
      expect(calls[0].args).toContain("add-generic-password");
      expect(calls[0].args).toContain("-s");
      expect(calls[0].args).toContain("vskill-anthropic");
      expect(calls[0].args).toContain("-w");
      expect(calls[0].args).toContain("sk-ant-test-1234");
      expect(store.readKey("anthropic")).toBe("sk-ant-test-1234");
    });

    it("removeKey wipes the entry idempotently", async () => {
      await store.saveKey("anthropic", "sk-ant-test-1234", "browser");
      await store.removeKey("anthropic");
      expect(store.readKey("anthropic")).toBe(null);
      await store.removeKey("anthropic"); // idempotent
    });

    it("rejects empty keys", async () => {
      await expect(store.saveKey("anthropic", "   ", "browser")).rejects.toThrow(
        /non-empty string/i,
      );
    });

    it("injected logger receives only the redacted key on failure paths", async () => {
      store._setPlatformOverride("darwin");
      const { spawnFn } = makeFakeSpawn(1); // non-zero exit
      store._setSpawn(spawnFn);
      const warns: string[] = [];
      const errors: string[] = [];
      store._setLogger({
        warn: (m) => warns.push(m),
        error: (m) => errors.push(m),
      });
      await expect(store.saveKey("anthropic", "sk-ant-full-key-2020", "keychain")).rejects.toThrow();
      // At most the ****<last-4> form should appear; never the full key.
      for (const line of [...warns, ...errors]) {
        expect(line).not.toContain("sk-ant-full-key-2020");
      }
      const found = [...warns, ...errors].join("\n");
      expect(found).toContain("****2020");
    });
  });

  describe("hasKeySync / readKeySync", () => {
    it("returns false/null when no key stored", () => {
      expect(store.hasKeySync("anthropic")).toBe(false);
      expect(store.readKeySync("anthropic")).toBe(null);
    });

    it("returns true/the key after save", async () => {
      await store.saveKey("openrouter", "sk-or-abc1234", "browser");
      expect(store.hasKeySync("openrouter")).toBe(true);
      expect(store.readKeySync("openrouter")).toBe("sk-or-abc1234");
    });
  });
});
