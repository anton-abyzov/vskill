// ---------------------------------------------------------------------------
// auth.test.ts — unit tests for `vskill auth {login,status,logout}`.
//
// Device Flow scenarios:
//   1. Happy path (login)
//   2. Slow_down response respects new interval
//   3. authorization_pending continues polling
//   4. expired_token aborts with clear error
//   5. access_denied aborts with clear error
//   6. Status — token present, GET /user prints @login
//   7. Status — token missing prints "not logged in"
//   8. Logout clears keychain
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { authCommand } from "../auth.js";
import type { Keychain } from "../../lib/keychain.js";

interface FakeKeychainState {
  token: string | null;
  /** 0839 US-005 — verified-skill `vsk_*` slot. */
  vskToken?: string | null;
}

function fakeKeychain(state: FakeKeychainState): Keychain {
  return {
    setGitHubToken(token) {
      state.token = token;
    },
    getGitHubToken() {
      return state.token;
    },
    clearGitHubToken() {
      const had = state.token !== null;
      state.token = null;
      return had;
    },
    setVskillToken(token) {
      state.vskToken = token;
    },
    getVskillToken() {
      return state.vskToken ?? null;
    },
    clearVskillToken() {
      const had = state.vskToken != null;
      state.vskToken = null;
      return had;
    },
    usingFallback() {
      return false;
    },
  };
}

interface FakeIO {
  stdoutBuf: string;
  stderrBuf: string;
  exitCode: number | null;
  io: {
    stdout: { write: (s: string) => boolean };
    stderr: { write: (s: string) => boolean };
    exit: (code: number) => void;
    openBrowser: (url: string) => Promise<void>;
  };
}

function fakeIO(): FakeIO {
  const f: FakeIO = {
    stdoutBuf: "",
    stderrBuf: "",
    exitCode: null,
    io: {
      stdout: {
        write: (s) => {
          f.stdoutBuf += s;
          return true;
        },
      },
      stderr: {
        write: (s) => {
          f.stderrBuf += s;
          return true;
        },
      },
      exit: (code) => {
        f.exitCode = code;
      },
      openBrowser: vi.fn(async () => {}),
    },
  };
  return f;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("vskill auth login (Device Flow)", () => {
  it("happy path: prints user code, polls, stores token, fetches user, prints login", async () => {
    const ks = { token: null as string | null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      // 1) POST /login/device/code
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc_abc",
          user_code: "A1B2C3D4",
          verification_uri: "https://github.com/login/device",
          interval: 5,
          expires_in: 900,
        }),
      )
      // 2) POST /login/oauth/access_token (success)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: "ghu_token_xyz",
          token_type: "bearer",
          scope: "read:user",
        }),
      )
      // 3) GET /user
      .mockResolvedValueOnce(jsonResponse(200, { login: "octocat", id: 1 }));

    const exitCode = await authCommand(
      ["login"],
      {
        io: f.io,
        keychain: fakeKeychain(ks),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: () => Promise.resolve(),
        clientId: "Iv1.test123",
        version: "test",
      },
    );

    expect(exitCode).toBe(0);
    expect(ks.token).toBe("ghu_token_xyz");
    expect(f.stdoutBuf).toContain("A1B2-C3D4");
    expect(f.stdoutBuf).toContain("https://github.com/login/device");
    expect(f.stdoutBuf).toMatch(/Logged in as @octocat/);
    expect(f.stderrBuf).not.toContain("ghu_token_xyz");
  });

  it("respects slow_down by extending poll interval", async () => {
    const sleeps: number[] = [];
    const ks = { token: null as string | null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "11112222",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { error: "authorization_pending" }))
      .mockResolvedValueOnce(jsonResponse(200, { error: "slow_down" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(jsonResponse(200, { login: "u", id: 2 }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      clientId: "Iv1.test",
      version: "t",
    });
    expect(exit).toBe(0);
    expect(ks.token).toBe("tok");
    // After slow_down (3rd call), interval should have grown by 5s
    expect(sleeps.some((s) => s >= 6000)).toBe(true);
  });

  it("aborts with non-zero exit on expired_token", async () => {
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "AAAABBBB",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 30,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { error: "expired_token" }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain({ token: null }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
    });
    expect(exit).toBe(1);
    expect(f.stderrBuf).toMatch(/expired/i);
  });

  it("aborts on access_denied", async () => {
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "DDDDEEEE",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { error: "access_denied" }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain({ token: null }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
    });
    expect(exit).toBe(1);
    expect(f.stderrBuf).toMatch(/denied/i);
  });

  it("login fails fast when client_id is missing", async () => {
    const f = fakeIO();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain({ token: null }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      clientId: "",
    });
    expect(exit).toBe(2);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock?.calls?.length ?? 0).toBe(0);
    expect(f.stderrBuf).toMatch(/VSKILL_GITHUB_CLIENT_ID/);
  });
});

describe("vskill auth status / logout", () => {
  it("status with token: validates via /user and prints login", async () => {
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { login: "anton", id: 9 })) as unknown as typeof fetch;

    const exit = await authCommand(["status"], {
      io: f.io,
      keychain: fakeKeychain({ token: "ghu_x" }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
    });
    expect(exit).toBe(0);
    expect(f.stdoutBuf).toMatch(/Logged in as @anton/);
  });

  it("status without token: prints not-logged-in hint, exit non-zero", async () => {
    const f = fakeIO();
    const exit = await authCommand(["status"], {
      io: f.io,
      keychain: fakeKeychain({ token: null }),
      fetchImpl: (() => {
        throw new Error("should not call fetch");
      }) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
    });
    expect(exit).toBe(1);
    expect(f.stdoutBuf + f.stderrBuf).toMatch(/Not logged in/i);
  });

  it("status --json emits machine-readable payload", async () => {
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { login: "anton", id: 9 })) as unknown as typeof fetch;
    const exit = await authCommand(["status", "--json"], {
      io: f.io,
      keychain: fakeKeychain({ token: "ghu_x" }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
    });
    expect(exit).toBe(0);
    const parsed = JSON.parse(f.stdoutBuf.trim());
    expect(parsed.loggedIn).toBe(true);
    expect(parsed.login).toBe("anton");
  });

  it("logout clears keychain and prints confirmation", async () => {
    const f = fakeIO();
    const ks: FakeKeychainState = { token: "ghu_present" };
    const exit = await authCommand(["logout"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: (() => {
        throw new Error("logout must not hit network");
      }) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      // Pin the revoke helper so the test never hits the network even if the
      // production lazy-import escapes the keychain branch.
      signOutAll: async () => {
        /* no-op */
      },
    });
    expect(exit).toBe(0);
    expect(ks.token).toBeNull();
    expect(f.stdoutBuf).toMatch(/Logged out/i);
  });
});

// ---------------------------------------------------------------------------
// 0839 — T-006 / T-007 / US-005 acceptance tests.
//
// Login → exchange → both tokens stored.
// Logout → clear both + best-effort revoke.
// ---------------------------------------------------------------------------

describe("0839 T-006 — auth login exchanges gho_ for vsk_", () => {
  it("happy path: stores BOTH gho_* and vsk_* tokens after exchange", async () => {
    const ks: FakeKeychainState = { token: null, vskToken: null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "ABCD1234",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_token" }))
      .mockResolvedValueOnce(jsonResponse(200, { login: "octocat", id: 1 }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      version: "test",
      exchangeForVskToken: async (token: string) => {
        expect(token).toBe("gho_token");
        return { token: "vsk_minted_xyz" };
      },
    });

    expect(exit).toBe(0);
    expect(ks.token).toBe("gho_token");
    expect(ks.vskToken).toBe("vsk_minted_xyz");
    expect(f.stdoutBuf).toMatch(/Logged in as @octocat/);
    // Should NOT print legacy-mode banner on the happy path.
    expect(f.stdoutBuf).not.toMatch(/legacy mode/i);
  });

  it("exchange 5xx: stores ONLY gho_*, prints legacy-mode banner, exits 0", async () => {
    const ks: FakeKeychainState = { token: null, vskToken: null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "DEAD1234",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_token2" }))
      .mockResolvedValueOnce(jsonResponse(200, { login: "octocat", id: 1 }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      version: "test",
      exchangeForVskToken: async () => {
        const e = new Error("exchange returned 503") as Error & {
          status?: number;
        };
        e.status = 503;
        throw e;
      },
    });

    expect(exit).toBe(0);
    expect(ks.token).toBe("gho_token2"); // gho stays
    expect(ks.vskToken).toBeNull(); // vsk NOT stored
    expect(f.stdoutBuf).toMatch(/legacy mode/i);
  });

  it("exchange returns no token: legacy-mode banner, exits 0", async () => {
    const ks: FakeKeychainState = { token: null, vskToken: null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "EEEE1111",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_token3" }))
      .mockResolvedValueOnce(jsonResponse(200, { login: "octocat", id: 1 }));

    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      version: "test",
      // Empty token in response — same legacy-mode handling.
      exchangeForVskToken: async () => ({ token: "" }),
    });

    expect(exit).toBe(0);
    expect(ks.token).toBe("gho_token3");
    expect(ks.vskToken).toBeNull();
    expect(f.stdoutBuf).toMatch(/legacy mode/i);
  });
});

describe("0839 F-004 — login + logout invalidate the in-memory auth cache", () => {
  it("login calls invalidateAuthCache after writing tokens", async () => {
    const ks: FakeKeychainState = { token: null, vskToken: null };
    const f = fakeIO();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: "dc",
          user_code: "F4F4F4F4",
          verification_uri: "https://github.com/login/device",
          interval: 1,
          expires_in: 60,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "gho_fresh" }))
      .mockResolvedValueOnce(jsonResponse(200, { login: "octocat", id: 1 }));

    const invalidateAuthCache = vi.fn();
    const exit = await authCommand(["login"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      version: "test",
      exchangeForVskToken: async () => ({ token: "vsk_minted" }),
      invalidateAuthCache,
    });

    expect(exit).toBe(0);
    // Once after writing gho_, once after writing vsk_. (We don't pin to
    // exactly 2 in case the impl chooses to consolidate — the contract is
    // "at least one" so the cache reflects the post-login state.)
    expect(invalidateAuthCache.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("logout calls invalidateAuthCache after clearing keychain", async () => {
    const ks: FakeKeychainState = { token: "gho_pre", vskToken: "vsk_pre" };
    const f = fakeIO();
    const invalidateAuthCache = vi.fn();

    const exit = await authCommand(["logout"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: (() => {
        throw new Error("logout must not hit network directly");
      }) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      signOutAll: async () => {},
      invalidateAuthCache,
    });

    expect(exit).toBe(0);
    expect(ks.token).toBeNull();
    expect(ks.vskToken).toBeNull();
    expect(invalidateAuthCache).toHaveBeenCalled();
  });
});

describe("0839 T-007 — auth logout revokes + clears both slots", () => {
  it("clears both keychain entries AND calls signOutAll", async () => {
    const ks: FakeKeychainState = { token: "gho_x", vskToken: "vsk_y" };
    const f = fakeIO();
    const signOutAll = vi.fn(async () => {});

    const exit = await authCommand(["logout"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: (() => {
        throw new Error("logout must not hit network directly");
      }) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      signOutAll,
    });

    expect(exit).toBe(0);
    expect(ks.token).toBeNull();
    expect(ks.vskToken).toBeNull();
    expect(signOutAll).toHaveBeenCalledOnce();
    expect(f.stdoutBuf).toMatch(/Logged out/i);
  });

  it("revoke failure does not block keychain clear (exit 0)", async () => {
    const ks: FakeKeychainState = { token: "gho_x", vskToken: "vsk_y" };
    const f = fakeIO();

    const exit = await authCommand(["logout"], {
      io: f.io,
      keychain: fakeKeychain(ks),
      fetchImpl: (() => {
        throw new Error("logout must not hit network directly");
      }) as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
      clientId: "Iv1.test",
      signOutAll: async () => {
        throw new Error("network down");
      },
    });

    expect(exit).toBe(0);
    expect(ks.token).toBeNull();
    expect(ks.vskToken).toBeNull();
    expect(f.stdoutBuf).toMatch(/Logged out/i);
  });
});
