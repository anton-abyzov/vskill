// ---------------------------------------------------------------------------
// add-tenant.test.ts — 0839 T-010 tenant-priority + 401/402 surfacing.
//
// We don't drive the full addCommand here (too many moving parts — that
// path is covered in add.test.ts). Instead we verify the two pieces of
// new behavior in isolation:
//
//   1. `--tenant <slug>` propagates into `process.env.VSKILL_TENANT`
//      and busts the API client's auth cache before the next request.
//   2. The resolver helper applies ADR-002 priority and surfaces the
//      right reason codes for caller-side messaging.
//
// 401/402 surfacing inside `installFromRegistry` uses the same `.status`
// + `.parsedBody` shape that `apiRequest` already attaches; we cover the
// resolver here and the integration in the e2e suite owned by the
// testing agent (T-014).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRequestHeaders,
  invalidateAuthCache,
  _resetClientAuthCacheForTests,
  _setKeychainForTests,
} from "../api/client.js";
import { addCommand } from "./add.js";
import { resolveTenant } from "../lib/tenant-resolver.js";
import type { Keychain } from "../lib/keychain.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-add-tenant-"));
}

function fakeKeychain(token: string | null): Keychain {
  return {
    setGitHubToken() {},
    getGitHubToken() {
      return null;
    },
    clearGitHubToken() {
      return false;
    },
    setVskillToken() {},
    getVskillToken() {
      return token;
    },
    clearVskillToken() {
      return false;
    },
    usingFallback() {
      return false;
    },
  };
}

describe("0839 T-010 — tenant-priority + API client integration", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.VSKILL_TENANT;
    delete process.env.VSKILL_TENANT;
    _resetClientAuthCacheForTests();
    _setKeychainForTests(fakeKeychain("vsk_test"));
  });
  afterEach(() => {
    if (savedEnv !== undefined) process.env.VSKILL_TENANT = savedEnv;
    else delete process.env.VSKILL_TENANT;
    _setKeychainForTests(null);
    _resetClientAuthCacheForTests();
  });

  it("VSKILL_TENANT env propagates into X-Vskill-Tenant header", () => {
    process.env.VSKILL_TENANT = "from-env";
    const headers = buildRequestHeaders();
    expect(headers["X-Vskill-Tenant"]).toBe("from-env");
  });

  it("flag-style tenantOverride beats env at the request layer", () => {
    process.env.VSKILL_TENANT = "from-env";
    const headers = buildRequestHeaders(undefined, { tenantOverride: "from-flag" });
    expect(headers["X-Vskill-Tenant"]).toBe("from-flag");
  });

  it("resetting the auth cache lets a freshly-set env value take effect", () => {
    // First call captures null tenant.
    let headers = buildRequestHeaders();
    expect(headers["X-Vskill-Tenant"]).toBeUndefined();

    // Mutate env + reset cache (mirrors what addCommand does on --tenant).
    process.env.VSKILL_TENANT = "now-acme";
    _resetClientAuthCacheForTests();

    headers = buildRequestHeaders();
    expect(headers["X-Vskill-Tenant"]).toBe("now-acme");
  });
});

describe("0839 F-004 — invalidateAuthCache (production-grade cache bust)", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.VSKILL_TENANT;
    delete process.env.VSKILL_TENANT;
    _resetClientAuthCacheForTests();
  });
  afterEach(() => {
    if (savedEnv !== undefined) process.env.VSKILL_TENANT = savedEnv;
    else delete process.env.VSKILL_TENANT;
    _setKeychainForTests(null);
    _resetClientAuthCacheForTests();
  });

  it("invalidateAuthCache() forces the next request to re-read keychain", () => {
    // Initial state: no token in keychain.
    let calls = 0;
    const tokens: Array<string | null> = [null, "vsk_after_login"];
    const dynamicKeychain: Keychain = {
      setGitHubToken() {},
      getGitHubToken() {
        return null;
      },
      clearGitHubToken() {
        return false;
      },
      setVskillToken() {},
      getVskillToken() {
        return tokens[Math.min(calls++, tokens.length - 1)];
      },
      clearVskillToken() {
        return false;
      },
      usingFallback() {
        return false;
      },
    };
    _setKeychainForTests(dynamicKeychain);

    // First call caches the null token (anonymous).
    const first = buildRequestHeaders();
    expect(first["Authorization"]).toBeUndefined();

    // Simulate `auth login` writing a fresh vsk_ token, then invalidating
    // the cache. Without invalidation the next call would still see null
    // (read-once-per-process semantics).
    invalidateAuthCache();

    // Next call re-reads the keychain — sees the new token.
    const second = buildRequestHeaders();
    expect(second["Authorization"]).toBe("Bearer vsk_after_login");
  });

  it("is exported as a stable public name (not the test-hook alias)", () => {
    // Type-level sanity — `invalidateAuthCache` exists and is callable.
    // This guards against an accidental rename that breaks auth.ts's
    // production import chain.
    expect(typeof invalidateAuthCache).toBe("function");
    invalidateAuthCache();
  });
});

describe("0839 F-001 — addCommand --tenant does not leak process.env mutation", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.VSKILL_TENANT;
    delete process.env.VSKILL_TENANT;
    _resetClientAuthCacheForTests();
  });
  afterEach(() => {
    if (savedEnv !== undefined) process.env.VSKILL_TENANT = savedEnv;
    else delete process.env.VSKILL_TENANT;
    _setKeychainForTests(null);
    _resetClientAuthCacheForTests();
  });

  it("restores VSKILL_TENANT when no prior value existed (delete branch)", async () => {
    // Drive addCommand far enough to traverse the try/finally without
    // making real network calls. We use an empty source and minimal opts —
    // the early "missing source" branch exits via process.exit, but the
    // try/finally must still run before process.exit is reached. To avoid
    // killing the test runner, stub process.exit briefly.
    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
      exitCode = code;
      // Throw so addCommand's await chain unwinds through finally.
      throw new Error("__test_exit__");
    }) as never;

    expect("VSKILL_TENANT" in process.env).toBe(false);

    try {
      await addCommand(undefined, { tenant: "acme" });
    } catch (err) {
      // Either the synthetic exit error or a downstream throw is fine —
      // the assertion below is what we care about.
      if ((err as Error).message !== "__test_exit__") {
        // Real failure — re-throw so the test reports it.
        process.exit = origExit;
        throw err;
      }
    } finally {
      process.exit = origExit;
    }

    // The flag was --tenant=acme, but no VSKILL_TENANT existed before.
    // After addCommand returns/throws, process.env.VSKILL_TENANT MUST NOT
    // be set — the finally arm restored the prior absent state.
    expect("VSKILL_TENANT" in process.env).toBe(false);
    expect(exitCode).toBe(1);
  });

  it("restores prior VSKILL_TENANT value when one existed", async () => {
    process.env.VSKILL_TENANT = "previous-tenant";
    const origExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = (() => {
      throw new Error("__test_exit__");
    }) as never;

    try {
      await addCommand(undefined, { tenant: "override-tenant" });
    } catch (err) {
      if ((err as Error).message !== "__test_exit__") {
        process.exit = origExit;
        throw err;
      }
    } finally {
      process.exit = origExit;
    }

    // The override was --tenant=override-tenant, but the prior value was
    // "previous-tenant". After addCommand exits, the prior value MUST be
    // restored.
    expect(process.env.VSKILL_TENANT).toBe("previous-tenant");
  });

  it("does NOT mutate VSKILL_TENANT when --tenant is absent", async () => {
    process.env.VSKILL_TENANT = "ci-pinned";
    const origExit = process.exit;
    (process as unknown as { exit: (code?: number) => never }).exit = (() => {
      throw new Error("__test_exit__");
    }) as never;

    try {
      await addCommand(undefined, {});
    } catch (err) {
      if ((err as Error).message !== "__test_exit__") {
        process.exit = origExit;
        throw err;
      }
    } finally {
      process.exit = origExit;
    }

    // No --tenant flag → no mutation, no restoration noise.
    expect(process.env.VSKILL_TENANT).toBe("ci-pinned");
  });
});

describe("0839 T-010 — resolver priority chain in addCommand context", () => {
  it("flag wins over config + env (ADR-002)", async () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ currentTenant: "from-config" }),
      { encoding: "utf8", mode: 0o600 },
    );

    const r = await resolveTenant({
      flag: "explicit",
      envValue: "from-env",
      activeTenantOptions: { configDir: dir },
      enableAutoPick: false,
    });
    expect(r.kind).toBe("flag");
    if (r.kind === "flag") expect(r.slug).toBe("explicit");
  });

  it("anonymous (401) is distinguished from no-tenants", async () => {
    const dir = tmpDir();
    const r = await resolveTenant({
      envValue: "",
      activeTenantOptions: { configDir: dir },
      listTenants: async () => {
        const e = new Error("401") as Error & { status?: number };
        e.status = 401;
        throw e;
      },
    });
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.reason).toBe("anonymous");
  });
});
