// @vitest-environment jsdom
// 0834 T-029 — AccountTauriBridge tests.
//
// AC-US12-03: Tauri Bearer auth integration. Verifies the bridge wires
// IPC results into the AccountContext shape correctly + falls back to
// cookie/null when not in a Tauri host.

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  createTauriAccountContext,
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

describe("createTauriAccountContext", () => {
  it("uses platformBaseUrl from IPC and builds Bearer headers", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "account_get_platform_url") return "https://verified-skill.dev";
      if (cmd === "account_get_token") return "vsk_abc";
      return null;
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const ctx = await createTauriAccountContext();
    expect(ctx.platformBaseUrl).toBe("https://verified-skill.dev");
    expect(ctx.authMode).toBe("bearer");
    expect(await ctx.getAuthHeader()).toBe("Bearer vsk_abc");
  });

  it("falls back to default platform URL when IPC returns null", async () => {
    const invoke = vi.fn(async () => null);
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const ctx = await createTauriAccountContext();
    expect(ctx.platformBaseUrl).toBe("https://verified-skill.com");
  });

  it("getAuthHeader returns null when no token is stored", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "account_get_platform_url") return "https://verified-skill.com";
      if (cmd === "account_get_token") return null;
      return null;
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const ctx = await createTauriAccountContext();
    expect(await ctx.getAuthHeader()).toBeNull();
  });

  it("swallows IPC errors and returns null token", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "account_get_platform_url") return "https://verified-skill.com";
      throw new Error("keychain locked");
    });
    (window as TauriWindowShape).__TAURI_INTERNALS__ = { invoke };

    const ctx = await createTauriAccountContext();
    expect(await ctx.getAuthHeader()).toBeNull();
  });
});
