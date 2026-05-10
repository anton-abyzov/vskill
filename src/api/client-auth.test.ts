// ---------------------------------------------------------------------------
// 0839 T-005 — Bearer interceptor + tenant header in `client.ts`.
//
// AC coverage:
//   AC-US1-01  — Authorization header present when token in keychain
//   AC-US1-02  — Anonymous when no token
//   AC-US1-06  — Keychain hit at most once per process (caching)
//   AC-US2-06  — `X-Vskill-Tenant: <slug>` header sent
//   AC-US5-04  — vsk_* preferred over gho_*
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  searchSkills,
  getSkill,
  apiRequest,
  buildRequestHeaders,
  listTenants,
  exchangeForVskToken,
  signOutAll,
  _setKeychainForTests,
  _resetClientAuthCacheForTests,
} from "./client.js";
import type { Keychain } from "../lib/keychain.js";
import { setActiveTenant } from "../lib/active-tenant.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Test scaffolding: a fake keychain and a per-test tmpdir for the active-tenant
// config file.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function fakeKeychain(opts: {
  vsk?: string | null;
  gho?: string | null;
} = {}): Keychain & { _ghoReadCount: number; _vskReadCount: number } {
  let ghoReads = 0;
  let vskReads = 0;
  const k: Keychain & { _ghoReadCount: number; _vskReadCount: number } = {
    _ghoReadCount: 0,
    _vskReadCount: 0,
    setGitHubToken() {},
    getGitHubToken() {
      ghoReads++;
      k._ghoReadCount = ghoReads;
      return opts.gho ?? null;
    },
    clearGitHubToken() {
      return false;
    },
    setVskillToken() {},
    getVskillToken() {
      vskReads++;
      k._vskReadCount = vskReads;
      return opts.vsk ?? null;
    },
    clearVskillToken() {
      return false;
    },
    usingFallback() {
      return false;
    },
  };
  return k;
}

function jsonResponse(data: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

let tmpDir: string;
const ENV_BACKUP: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  _setKeychainForTests(null);
  _resetClientAuthCacheForTests();
  // Per-test tmpdir; setActiveTenant writes here, freeing each test from
  // touching the user's real ~/.vskill/config.json.
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-client-auth-"));
  ENV_BACKUP.VSKILL_CONFIG_DIR = process.env.VSKILL_CONFIG_DIR;
  ENV_BACKUP.VSKILL_TENANT = process.env.VSKILL_TENANT;
  process.env.VSKILL_CONFIG_DIR = tmpDir;
  delete process.env.VSKILL_TENANT;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("client.ts — Bearer interceptor (0839 T-005)", () => {
  it("AC-US1-02: no token => no Authorization header", async () => {
    _setKeychainForTests(fakeKeychain({}));
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const call = mockFetch.mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("AC-US1-01: vsk_ token => Authorization: Bearer vsk_*", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_abc" }));
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer vsk_abc");
  });

  it("AC-US5-04: vsk_ preferred when both vsk_ and gho_ present", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_pref", gho: "gho_fallback" }));
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer vsk_pref");
  });

  it("AC-US5-04 fallback: gho_ used when vsk_ missing", async () => {
    _setKeychainForTests(fakeKeychain({ gho: "gho_only" }));
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer gho_only");
  });

  it("AC-US2-06: active tenant => X-Vskill-Tenant header", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    setActiveTenant("acme-corp", { configDir: tmpDir });
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Vskill-Tenant"]).toBe("acme-corp");
  });

  it("AC-US2-06: VSKILL_TENANT env beats config file", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    setActiveTenant("config-tenant", { configDir: tmpDir });
    process.env.VSKILL_TENANT = "env-tenant";
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("hello");

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Vskill-Tenant"]).toBe("env-tenant");
  });

  it("AC-US2-06: tenantOverride flag beats env and config", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    setActiveTenant("config-tenant", { configDir: tmpDir });
    process.env.VSKILL_TENANT = "env-tenant";
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await apiRequest<unknown>("/api/v1/health", { tenantOverride: "flag-tenant" });

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Vskill-Tenant"]).toBe("flag-tenant");
  });

  it("AC-US1-06: keychain hit at most once across many calls (cached)", async () => {
    const kc = fakeKeychain({ vsk: "vsk_cached" });
    _setKeychainForTests(kc);
    mockFetch.mockResolvedValue(jsonResponse({ results: [] }));

    await searchSkills("a");
    await searchSkills("b");
    await searchSkills("c");

    expect(kc._vskReadCount).toBe(1);
    expect(kc._ghoReadCount).toBe(0); // never reached fallback
  });

  it("buildRequestHeaders: standalone helper attaches Content-Type + UA", () => {
    _setKeychainForTests(fakeKeychain({}));
    const headers = buildRequestHeaders();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("vskill-cli");
  });

  it("apiRequest: 401 errors carry status on the thrown Error", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    let err: (Error & { status?: number }) | null = null;
    try {
      await apiRequest("/api/v1/skills/search?q=x");
    } catch (e) {
      err = e as Error & { status?: number };
    }
    expect(err).toBeTruthy();
    expect(err!.status).toBe(401);
  });

  it("apiRequest: 402 errors expose parsedBody.upgradeUrl", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    const body = JSON.stringify({
      message: "Upgrade required",
      upgradeUrl: "https://verified-skill.com/billing",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 402,
      statusText: "Payment Required",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(body),
    } as unknown as Response);

    let err: (Error & { status?: number; parsedBody?: { upgradeUrl?: string } }) | null = null;
    try {
      await apiRequest("/api/v1/skills/private");
    } catch (e) {
      err = e as Error & { status?: number; parsedBody?: { upgradeUrl?: string } };
    }
    expect(err).toBeTruthy();
    expect(err!.status).toBe(402);
    expect(err!.parsedBody?.upgradeUrl).toBe("https://verified-skill.com/billing");
  });
});

describe("client.ts — listTenants (0839 T-005, supports T-008)", () => {
  it("returns mapped tenants array on success", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_x" }));
    mockFetch.mockResolvedValue(
      jsonResponse({
        tenants: [
          { tenantId: "t1", slug: "acme", name: "Acme", role: "owner", installationId: 42 },
          { tenantId: "t2", slug: "contoso", name: "Contoso", role: "member" },
        ],
      }),
    );
    const out = await listTenants();
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      tenantId: "t1",
      slug: "acme",
      name: "Acme",
      role: "owner",
      installationId: 42,
    });
    expect(out[1].installationId).toBeNull();
  });

  it("hits the right endpoint with auth header", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_y" }));
    mockFetch.mockResolvedValue(jsonResponse({ tenants: [] }));

    await listTenants();

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/v1/account/tenants");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer vsk_y");
  });
});

describe("client.ts — exchangeForVskToken (0839 T-005, supports T-006)", () => {
  it("POSTs to /auth/github/exchange-for-vsk-token with the gho_ token", async () => {
    _setKeychainForTests(fakeKeychain({})); // no token in keychain at exchange time
    mockFetch.mockResolvedValue(
      jsonResponse({
        token: "vsk_minted",
        expiresAt: "2026-08-07T00:00:00Z",
        scopes: ["read", "write"],
        userId: "u_1",
      }),
    );

    const resp = await exchangeForVskToken("gho_input");

    expect(resp.token).toBe("vsk_minted");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/v1/auth/github/exchange-for-vsk-token");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ githubToken: "gho_input" });
  });
});

describe("client.ts — signOutAll (0839 T-005, supports T-007)", () => {
  it("issues DELETE /api/v1/auth/sign-out-all", async () => {
    _setKeychainForTests(fakeKeychain({ vsk: "vsk_z" }));
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

    await signOutAll();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });
});

describe("client.ts — getSkill still works anonymously (regression)", () => {
  it("AC-US1-03: getSkill inherits the interceptor — no extra fetch sites", async () => {
    _setKeychainForTests(fakeKeychain({}));
    mockFetch.mockResolvedValue(jsonResponse({ skill: { name: "x" } }));
    await getSkill("x");
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["User-Agent"]).toBe("vskill-cli");
  });
});
