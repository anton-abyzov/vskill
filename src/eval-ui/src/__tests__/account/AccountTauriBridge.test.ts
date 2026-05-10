// @vitest-environment jsdom
// 0834 T-029 / 0836 US-003 — AccountTauriBridge tests.
//
// 0836 US-003: the bridge no longer mints `Authorization: Bearer ${token}`.
// The deleted `account_get_token` IPC moved the bearer Rust-side; the
// eval-server platform-proxy injects it for `/api/v1/account/*`. The bridge
// now returns a cookie-mode AccountContext value with `platformBaseUrl: ""`
// (same-origin, fetched through the eval-server) and a no-op
// `getAuthHeader` returning null.

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  createTauriAccountContext,
  getAccountUserSummary,
  isTauriHost,
} from "../../contexts/AccountTauriBridge";

interface TauriWindowShape extends Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string) => Promise<unknown>;
  };
}

afterEach(() => {
  delete (window as TauriWindowShape).__TAURI_INTERNALS__;
});

describe("isTauriHost", () => {
  it("returns false when no Tauri internals are present", () => {
    expect(isTauriHost()).toBe(false);
  });

  it("returns true when window.__TAURI_INTERNALS__.invoke is set", () => {
    (window as TauriWindowShape).__TAURI_INTERNALS__ = {
      invoke: async () => undefined,
    };
    expect(isTauriHost()).toBe(true);
  });
});

describe("createTauriAccountContext (0836 US-003: cookie-mode, no bearer)", () => {
  it("returns a same-origin / cookie-mode context with null getAuthHeader", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "account_get_platform_url") return "https://verified-skill.dev";
      return null;
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const ctx = await createTauriAccountContext();
    expect(ctx.platformBaseUrl).toBe("");
    expect(ctx.authMode).toBe("cookie");
    expect(await ctx.getAuthHeader()).toBeNull();
  });

  it("does not invoke the deleted account_get_token IPC", async () => {
    const invoke = vi.fn(async () => null);
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    await createTauriAccountContext();
    const calls = invoke.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain("account_get_token");
  });

  it("works without Tauri internals (web build) — returns same default", async () => {
    // Even without the IPC bridge, the desktop bundle can construct a
    // context (jsdom defaults). This exercises the no-op fallback path.
    const ctx = await createTauriAccountContext();
    expect(ctx.platformBaseUrl).toBe("");
    expect(ctx.authMode).toBe("cookie");
    expect(await ctx.getAuthHeader()).toBeNull();
  });
});

describe("getAccountUserSummary (0836 US-003)", () => {
  it("returns the IPC payload verbatim when present", async () => {
    const summary = {
      signedIn: true,
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      tier: "pro" as const,
    };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "account_get_user_summary") return summary;
      return null;
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const got = await getAccountUserSummary();
    expect(got).toEqual(summary);
  });

  it("falls back to a clean signed-out shape when IPC is unavailable", async () => {
    delete (window as TauriWindowShape).__TAURI_INTERNALS__;
    const got = await getAccountUserSummary();
    expect(got).toEqual({
      signedIn: false,
      login: null,
      avatarUrl: null,
      tier: "free",
    });
  });

  it("falls back to signed-out shape when the IPC throws", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("keychain locked");
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const got = await getAccountUserSummary();
    expect(got.signedIn).toBe(false);
    expect(got.tier).toBe("free");
  });
});
