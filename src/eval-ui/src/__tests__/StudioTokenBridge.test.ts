// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0836 US-002 — Tests for the X-Studio-Token fetch patch.
//
// Covers:
//   - patch is a no-op outside Tauri (web build)
//   - patch injects X-Studio-Token on /api/* requests inside Tauri
//   - non-/api requests are NOT touched
//   - cross-origin /api requests are NOT touched
//   - patching twice is idempotent
//   - get_studio_token IPC failure → fall through with no header
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetStudioTokenBridgeForTests,
  installStudioTokenFetchPatch,
} from "../contexts/StudioTokenBridge";

const FAKE_TOKEN = "tok-AbCdEfGh-test-token-value-9999999999999999";

interface MockTauri {
  invoke: ReturnType<typeof vi.fn>;
}

function setTauriHost(invokeImpl: (cmd: string) => unknown): void {
  const w = window as unknown as Record<string, unknown>;
  const fake: MockTauri = {
    invoke: vi.fn(async (cmd: string) => invokeImpl(cmd)),
  };
  w.__TAURI_INTERNALS__ = fake;
}

function clearTauriHost(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
}

describe("StudioTokenBridge.installStudioTokenFetchPatch", () => {
  let baseFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetStudioTokenBridgeForTests();
    baseFetch = vi.fn(async () => new Response("ok"));
    globalThis.fetch = baseFetch as unknown as typeof fetch;
    // jsdom provides window.location with an origin we can pin against.
    if (!window.location || window.location.origin === "null") {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { origin: "http://localhost:3162" },
      });
    }
  });

  afterEach(() => {
    _resetStudioTokenBridgeForTests();
    clearTauriHost();
  });

  it("is a no-op outside Tauri (web build): no fetch wrapper installed", async () => {
    clearTauriHost();
    const before = globalThis.fetch;
    installStudioTokenFetchPatch();
    expect(globalThis.fetch).toBe(before);

    await globalThis.fetch("/api/skills", {});
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.has("X-Studio-Token")).toBe(false);
  });

  it("injects X-Studio-Token on relative /api/* requests inside Tauri", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();

    await globalThis.fetch("/api/skills");
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.get("X-Studio-Token")).toBe(FAKE_TOKEN);
  });

  it("injects X-Studio-Token on same-origin absolute /api/* URL", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();

    // Build a same-origin URL using whatever origin jsdom assigned. We
    // can't hard-code one because Vitest's jsdom defaults to "about:blank"
    // in some versions and a real origin in others.
    const sameOriginUrl = `${window.location.origin}/api/skills`;
    await globalThis.fetch(sameOriginUrl);
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.get("X-Studio-Token")).toBe(FAKE_TOKEN);
  });

  it("does NOT inject on non-/api paths", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();

    await globalThis.fetch("/index.html");
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.has("X-Studio-Token")).toBe(false);
  });

  it("does NOT inject on cross-origin URLs even when path looks like /api/*", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();

    await globalThis.fetch("https://verified-skill.com/api/v1/skills");
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.has("X-Studio-Token")).toBe(false);
  });

  it("is idempotent — calling twice does not double-wrap fetch", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();
    const onceWrapped = globalThis.fetch;
    installStudioTokenFetchPatch();
    expect(globalThis.fetch).toBe(onceWrapped);
  });

  it("falls through when the IPC returns null (token not yet captured)", async () => {
    setTauriHost(() => null);
    installStudioTokenFetchPatch();

    const res = await globalThis.fetch("/api/skills");
    expect(res).toBeInstanceOf(Response);
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.has("X-Studio-Token")).toBe(false);
  });

  it("caches the token across multiple /api/* calls (single IPC roundtrip)", async () => {
    let calls = 0;
    setTauriHost((cmd) => {
      if (cmd === "get_studio_token") {
        calls++;
        return FAKE_TOKEN;
      }
      return null;
    });
    installStudioTokenFetchPatch();

    await globalThis.fetch("/api/skills");
    await globalThis.fetch("/api/projects");
    await globalThis.fetch("/api/health");
    expect(calls).toBe(1);
  });

  it("preserves caller-supplied headers (does not clobber Content-Type)", async () => {
    setTauriHost((cmd) => (cmd === "get_studio_token" ? FAKE_TOKEN : null));
    installStudioTokenFetchPatch();

    await globalThis.fetch("/api/skills/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Custom": "foo" },
      body: "{}",
    });
    const init = baseFetch.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers ?? {});
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Custom")).toBe("foo");
    expect(headers.get("X-Studio-Token")).toBe(FAKE_TOKEN);
  });
});
