// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeSignedInUser,
  normalizeUpdateInfo,
  openExternalUrlViaDesktop,
} from "./useDesktopBridge";

const originalFetch = globalThis.fetch;

describe("normalizeUpdateInfo", () => {
  it("maps the Rust updater wire shape into the Preferences UI shape", () => {
    const info = normalizeUpdateInfo(
      {
        available: true,
        version: "1.0.40",
        notes: "Desktop release notes from latest.json",
        pub_date: "2026-05-20T06:00:00Z",
      },
      "1.0.39",
    );

    expect(info).toEqual({
      available: true,
      currentVersion: "1.0.39",
      latestVersion: "1.0.40",
      releaseNotes: "Desktop release notes from latest.json",
      releaseDate: "2026-05-20T06:00:00Z",
    });
  });
});

describe("normalizeSignedInUser", () => {
  it("accepts camelCase avatarUrl from desktop OAuth status", () => {
    expect(normalizeSignedInUser({
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      email: null,
      cached_at: null,
    })).toEqual({
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
      email: null,
      cached_at: null,
    });
  });

  it("falls back to a GitHub avatar URL when the payload has no avatar", () => {
    expect(normalizeSignedInUser({ login: "octocat" })?.avatar_url)
      .toBe("https://github.com/octocat.png?size=40");
  });
});

describe("openExternalUrlViaDesktop", () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses the desktop open_external_url command first", async () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: typeof invoke };
    }).__TAURI_INTERNALS__ = { invoke };

    await openExternalUrlViaDesktop("https://github.com/octocat");

    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://github.com/octocat",
    });
  });

  it("falls back to the Tauri shell global when the app command fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invoke = vi.fn(async () => {
      throw new Error("ACL denied");
    });
    const open = vi.fn(async () => undefined);
    globalThis.fetch = vi.fn(async () => {
      throw new Error("sidecar unavailable");
    }) as unknown as typeof fetch;
    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: typeof invoke };
    }).__TAURI_INTERNALS__ = { invoke };
    (window as unknown as {
      __TAURI__: { shell: { open: typeof open } };
    }).__TAURI__ = { shell: { open } };

    await openExternalUrlViaDesktop("https://github.com/octocat");

    expect(open).toHaveBeenCalledWith("https://github.com/octocat");
  });

  it("falls back to the sidecar opener when the app command fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invoke = vi.fn(async () => {
      throw new Error("ACL denied");
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: typeof invoke };
    }).__TAURI_INTERNALS__ = { invoke };

    await openExternalUrlViaDesktop("https://github.com/octocat");

    expect(fetchSpy).toHaveBeenCalledWith("/api/desktop/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/octocat" }),
    });
  });
});
