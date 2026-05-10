// ---------------------------------------------------------------------------
// 0839 T-004 — `~/.vskill/config.json` active-tenant helper.
//
// Verifies the contract of `getActiveTenant`/`setActiveTenant`:
//  - read-modify-write preserves unknown keys (AC-US3-06)
//  - atomic write via .tmp + rename (no partial files on race)
//  - missing/corrupt file returns null without throwing
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getActiveTenant,
  setActiveTenant,
  readConfig,
  getConfigPath,
  type ActiveTenantFs,
} from "../active-tenant.js";

interface FakeFsState {
  files: Map<string, { content: string; mode: number }>;
  dirs: Set<string>;
  /** Operations log to assert atomicity. */
  ops: string[];
}

function fakeFs(state: FakeFsState): ActiveTenantFs {
  return {
    existsSync(p) {
      return state.files.has(p) || state.dirs.has(p);
    },
    readFileSync(p) {
      const f = state.files.get(p);
      if (!f) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      return f.content;
    },
    writeFileSync(p, c, mode) {
      state.ops.push(`write:${p}`);
      state.files.set(p, { content: c, mode });
    },
    renameSync(a, b) {
      state.ops.push(`rename:${a}->${b}`);
      const f = state.files.get(a);
      if (!f) throw new Error(`ENOENT: ${a}`);
      state.files.set(b, f);
      state.files.delete(a);
    },
    mkdirSync(p) {
      state.dirs.add(p);
    },
    unlinkSync(p) {
      state.files.delete(p);
    },
  };
}

function newState(): FakeFsState {
  return { files: new Map(), dirs: new Set(), ops: [] };
}

describe("active-tenant helper (0839 T-004)", () => {
  const dir = "/tmp/vskill-test-config";

  it("getActiveTenant returns null when config file is missing", () => {
    const state = newState();
    expect(
      getActiveTenant({ configDir: dir, fs: fakeFs(state) }),
    ).toBeNull();
  });

  it("setActiveTenant writes currentTenant to a fresh config", () => {
    const state = newState();
    setActiveTenant("acme", { configDir: dir, fs: fakeFs(state) });
    const written = state.files.get(`${dir}/config.json`);
    expect(written).toBeTruthy();
    expect(JSON.parse(written!.content)).toEqual({ currentTenant: "acme" });
    expect(written!.mode).toBe(0o600);
  });

  it("setActiveTenant preserves unknown keys (forward-compat AC-US3-06)", () => {
    const state = newState();
    state.files.set(`${dir}/config.json`, {
      content: JSON.stringify({ foo: "bar", currentTenant: "old", nested: { a: 1 } }),
      mode: 0o600,
    });
    setActiveTenant("new", { configDir: dir, fs: fakeFs(state) });
    const written = state.files.get(`${dir}/config.json`);
    const parsed = JSON.parse(written!.content);
    expect(parsed.foo).toBe("bar");
    expect(parsed.nested).toEqual({ a: 1 });
    expect(parsed.currentTenant).toBe("new");
  });

  it("setActiveTenant uses atomic write (.tmp then rename)", () => {
    const state = newState();
    setActiveTenant("acme", { configDir: dir, fs: fakeFs(state) });
    // ops should include a write to a .tmp path followed by a rename
    // to the canonical config.json.
    const tmpWrite = state.ops.find((o) =>
      o.startsWith(`write:${dir}/config.json.`) && o.endsWith(".tmp"),
    );
    const rename = state.ops.find((o) =>
      o.startsWith(`rename:${dir}/config.json.`) &&
      o.endsWith(`->${dir}/config.json`),
    );
    expect(tmpWrite).toBeTruthy();
    expect(rename).toBeTruthy();
  });

  it("getActiveTenant reads currentTenant from existing file", () => {
    const state = newState();
    state.files.set(`${dir}/config.json`, {
      content: JSON.stringify({ currentTenant: "contoso", other: 42 }),
      mode: 0o600,
    });
    expect(
      getActiveTenant({ configDir: dir, fs: fakeFs(state) }),
    ).toBe("contoso");
  });

  it("getActiveTenant tolerates a corrupt file (returns null, no throw)", () => {
    const state = newState();
    state.files.set(`${dir}/config.json`, {
      content: "{ this is not json",
      mode: 0o600,
    });
    expect(
      getActiveTenant({ configDir: dir, fs: fakeFs(state) }),
    ).toBeNull();
  });

  it("setActiveTenant(null) clears the field but preserves other keys", () => {
    const state = newState();
    state.files.set(`${dir}/config.json`, {
      content: JSON.stringify({ foo: "bar", currentTenant: "old" }),
      mode: 0o600,
    });
    setActiveTenant(null, { configDir: dir, fs: fakeFs(state) });
    const parsed = JSON.parse(state.files.get(`${dir}/config.json`)!.content);
    expect(parsed.currentTenant).toBeUndefined();
    expect(parsed.foo).toBe("bar");
  });

  it("readConfig surfaces the entire object", () => {
    const state = newState();
    state.files.set(`${dir}/config.json`, {
      content: JSON.stringify({ a: 1, currentTenant: "x" }),
      mode: 0o600,
    });
    expect(
      readConfig({ configDir: dir, fs: fakeFs(state) }),
    ).toEqual({ a: 1, currentTenant: "x" });
  });

  it("getConfigPath honors VSKILL_CONFIG_DIR env override", () => {
    const old = process.env.VSKILL_CONFIG_DIR;
    process.env.VSKILL_CONFIG_DIR = "/tmp/env-override";
    try {
      expect(getConfigPath()).toBe("/tmp/env-override/config.json");
    } finally {
      if (old === undefined) delete process.env.VSKILL_CONFIG_DIR;
      else process.env.VSKILL_CONFIG_DIR = old;
    }
  });

  it("setActiveTenant creates the config dir when it does not exist", () => {
    const state = newState();
    setActiveTenant("acme", { configDir: dir, fs: fakeFs(state) });
    expect(state.dirs.has(dir)).toBe(true);
  });
});
