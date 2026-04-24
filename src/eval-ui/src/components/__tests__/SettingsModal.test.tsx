// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0702 T-050 (US-004 / US-005): SettingsModal v2.
//
// New contract (post-0702):
//   - No tier radio, no "Browser storage" / "macOS Keychain" copy
//   - Three provider rows: anthropic, openai, openrouter (from PROVIDERS)
//   - Save POSTs `{ provider, key }` — no `tier` field
//   - Storage path rendered from GET /api/settings/storage-path
//   - "Copy path" button copies absolute path to clipboard
//   - No raw key persisted in React state across a render boundary
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_PATH = "/Users/test/.vskill/keys.env";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchMock(options: {
  keysResponse?: Record<string, { stored: boolean; updatedAt: string | null }>;
  pathResponse?: { path: string };
  pathStatus?: number;
  saveResponse?: { ok: boolean; warning?: string };
  saveStatus?: number;
  migrationStatus?: { pending: boolean; darwinKeys?: string[] } | (() => { pending: boolean; darwinKeys?: string[] });
  migrationPerformResponse?: { migrated: string[] };
  migrationAckResponse?: { ok: boolean };
}): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });

    if (url.endsWith("/api/settings/keys") && (!init || init.method === undefined || init.method === "GET")) {
      const body = options.keysResponse ?? {
        anthropic: { stored: false, updatedAt: null },
        openai: { stored: false, updatedAt: null },
        openrouter: { stored: false, updatedAt: null },
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/settings/keys") && init?.method === "POST") {
      const body = options.saveResponse ?? { ok: true };
      return new Response(JSON.stringify(body), { status: options.saveStatus ?? 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/settings/keys/") && init?.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/settings/storage-path")) {
      const body = options.pathResponse ?? { path: STORAGE_PATH };
      const status = options.pathStatus ?? 200;
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/settings/migration-status")) {
      const raw = options.migrationStatus;
      const body = typeof raw === "function" ? raw() : (raw ?? { pending: false });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/settings/migration-perform") && init?.method === "POST") {
      const body = options.migrationPerformResponse ?? { migrated: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/api/settings/migration-acknowledge") && init?.method === "POST") {
      const body = options.migrationAckResponse ?? { ok: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch | undefined }).fetch = original;
    },
  };
}

async function renderModal(props: Partial<{
  open: boolean;
  initialProvider: "anthropic" | "openai" | "openrouter";
  onClose: () => void;
  onToast: (m: string) => void;
}> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SettingsModal } = await import("../SettingsModal");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(SettingsModal, {
        open: props.open ?? true,
        onClose: props.onClose ?? vi.fn(),
        initialProvider: props.initialProvider,
        onToast: props.onToast,
      }),
    );
  });
  // Allow useEffect-driven fetches (listKeys + storage-path) to settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
  return { container, root, act, React };
}

describe("0702 T-050: SettingsModal v2 — no tier, 3 providers, storage path", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders exactly 3 provider rows: anthropic, openai, openrouter", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      expect(document.querySelector("[data-testid='provider-row-anthropic']")).toBeTruthy();
      expect(document.querySelector("[data-testid='provider-row-openai']")).toBeTruthy();
      expect(document.querySelector("[data-testid='provider-row-openrouter']")).toBeTruthy();

      // Exactly 3 — nothing else.
      const rows = document.querySelectorAll("[data-testid^='provider-row-']");
      expect(rows.length).toBe(3);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("does NOT render a tier radio (no input[name=storage-tier])", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      const radio = document.querySelector("input[name='storage-tier']");
      expect(radio).toBeNull();

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("fetches and renders the literal storage path from /api/settings/storage-path", async () => {
    const fetchHandle = installFetchMock({ pathResponse: { path: STORAGE_PATH } });
    try {
      const { container, root, act } = await renderModal();

      const footer = document.querySelector("[data-testid='settings-storage-path']");
      expect(footer).toBeTruthy();
      expect(footer!.textContent).toContain(STORAGE_PATH);

      // Must have called the new endpoint.
      const calledPath = fetchHandle.calls.some((c) => c.url.endsWith("/api/settings/storage-path"));
      expect(calledPath).toBe(true);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("falls back to a generic label when storage-path endpoint fails", async () => {
    const fetchHandle = installFetchMock({ pathStatus: 500 });
    try {
      const { container, root, act } = await renderModal();

      const footer = document.querySelector("[data-testid='settings-storage-path']");
      expect(footer).toBeTruthy();
      // No path, but a graceful fallback.
      expect(footer!.textContent).toMatch(/stored locally/i);
      expect(footer!.textContent).not.toContain(STORAGE_PATH);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("Save POSTs { provider, key } WITHOUT a tier field", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act, React } = await renderModal();

      const input = document.querySelector(
        "[data-testid='provider-row-openai'] input[data-provider='openai']",
      ) as HTMLInputElement;
      expect(input).toBeTruthy();

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "sk-proj-TESTKEY");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const saveBtn = document.querySelector(
        "[data-testid='save-openai']",
      ) as HTMLButtonElement;
      await act(async () => {
        saveBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      const postCall = fetchHandle.calls.find(
        (c) => c.url.endsWith("/api/settings/keys") && c.init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall!.init!.body as string) as Record<string, unknown>;
      expect(body).toEqual({ provider: "openai", key: "sk-proj-TESTKEY" });
      expect("tier" in body).toBe(false);

      act(() => root.unmount());
      container.remove();
      // Ignore unused React for linter — renderModal returned it.
      void React;
    } finally {
      fetchHandle.restore();
    }
  });

  it("Show toggle flips the input from password to text", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      const input = document.querySelector(
        "[data-testid='provider-row-anthropic'] input[data-provider='anthropic']",
      ) as HTMLInputElement;
      expect(input.type).toBe("password");

      const showBtn = Array.from(
        document.querySelectorAll("[data-testid='provider-row-anthropic'] button"),
      ).find((b) => /show/i.test(b.textContent ?? "")) as HTMLButtonElement;
      expect(showBtn).toBeTruthy();

      await act(async () => {
        showBtn.click();
      });

      expect(input.type).toBe("text");

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("Remove button calls DELETE /api/settings/keys/:provider when key is stored", async () => {
    const fetchHandle = installFetchMock({
      keysResponse: {
        anthropic: { stored: true, updatedAt: new Date().toISOString() },
        openai: { stored: false, updatedAt: null },
        openrouter: { stored: false, updatedAt: null },
      },
    });
    try {
      const { container, root, act } = await renderModal();

      const removeBtn = document.querySelector(
        "[data-testid='remove-anthropic']",
      ) as HTMLButtonElement;
      expect(removeBtn).toBeTruthy();

      await act(async () => {
        removeBtn.click();
      });
      const confirmBtn = document.querySelector(
        "[data-testid='remove-confirm-anthropic']",
      ) as HTMLButtonElement;
      expect(confirmBtn).toBeTruthy();

      await act(async () => {
        confirmBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      const deleteCall = fetchHandle.calls.find(
        (c) => c.url.endsWith("/api/settings/keys/anthropic") && c.init?.method === "DELETE",
      );
      expect(deleteCall).toBeTruthy();

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("Copy path button writes the absolute path to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = (navigator as unknown as { clipboard?: unknown }).clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText: vi.fn() },
      writable: true,
      configurable: true,
    });

    const fetchHandle = installFetchMock({ pathResponse: { path: STORAGE_PATH } });
    try {
      const { container, root, act } = await renderModal();

      const copyBtn = document.querySelector(
        "[data-testid='settings-copy-path']",
      ) as HTMLButtonElement;
      expect(copyBtn).toBeTruthy();

      await act(async () => {
        copyBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(writeText).toHaveBeenCalledWith(STORAGE_PATH);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
      if (originalClipboard !== undefined) {
        Object.defineProperty(navigator, "clipboard", {
          value: originalClipboard,
          writable: true,
          configurable: true,
        });
      }
    }
  });

  it("renders no 'macOS Keychain' or 'Browser storage' text anywhere", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      const modal = document.querySelector("[data-testid='settings-modal']") as HTMLElement;
      const text = modal.textContent ?? "";
      expect(text).not.toMatch(/macOS Keychain/i);
      expect(text).not.toMatch(/Browser storage/i);
      expect(text).not.toMatch(/\btier\b/i);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("OpenAI row links to platform.openai.com/api-keys and shows sk-proj placeholder", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      const row = document.querySelector("[data-testid='provider-row-openai']") as HTMLElement;
      expect(row).toBeTruthy();

      const link = row.querySelector("a") as HTMLAnchorElement;
      expect(link.href).toContain("platform.openai.com/api-keys");

      const input = row.querySelector("input[data-provider='openai']") as HTMLInputElement;
      expect(input.placeholder).toMatch(/sk-proj/i);

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("Save clears the input immediately after POST completes (no raw key lingering in state)", async () => {
    const fetchHandle = installFetchMock({});
    try {
      const { container, root, act } = await renderModal();

      const input = document.querySelector(
        "[data-testid='provider-row-anthropic'] input[data-provider='anthropic']",
      ) as HTMLInputElement;

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "sk-ant-SHOULDCLEAR");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const saveBtn = document.querySelector(
        "[data-testid='save-anthropic']",
      ) as HTMLButtonElement;
      await act(async () => {
        saveBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      // After save, the input must be cleared.
      expect(input.value).toBe("");

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 0702 T-050 (US-006): Migration banner for legacy macOS Keychain users.
//
// Server exposes three endpoints:
//   GET  /api/settings/migration-status     → { pending, darwinKeys? }
//   POST /api/settings/migration-perform    → { migrated: string[] }
//   POST /api/settings/migration-acknowledge → { ok: true }
//
// The banner appears at the top of the Settings modal when pending=true,
// offers a primary "Migrate" action and a "Dismiss for 30 days" link.
// Both actions hide the banner and re-query migration-status.
// ---------------------------------------------------------------------------

describe("0702 T-050: Migration banner (US-006)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does NOT render the migration banner when migration-status.pending=false", async () => {
    const fetchHandle = installFetchMock({ migrationStatus: { pending: false } });
    try {
      const { container, root, act } = await renderModal();

      const banner = document.querySelector("[data-testid='migration-banner']");
      expect(banner).toBeNull();

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("renders the migration banner with Migrate + Dismiss affordances when pending=true", async () => {
    const fetchHandle = installFetchMock({
      migrationStatus: { pending: true, darwinKeys: ["anthropic", "openrouter"] },
    });
    try {
      const { container, root, act } = await renderModal();

      const banner = document.querySelector("[data-testid='migration-banner']") as HTMLElement;
      expect(banner).toBeTruthy();
      expect(banner.textContent ?? "").toMatch(/Migrate from macOS Keychain/i);

      const migrate = banner.querySelector("[data-testid='migration-migrate']") as HTMLButtonElement;
      const dismiss = banner.querySelector("[data-testid='migration-dismiss']") as HTMLElement;
      expect(migrate).toBeTruthy();
      expect(dismiss).toBeTruthy();

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });

  it("clicking Migrate POSTs to /api/settings/migration-perform and hides the banner", async () => {
    let pending = true;
    const fetchHandle = installFetchMock({
      migrationStatus: () =>
        pending ? { pending: true, darwinKeys: ["anthropic"] } : { pending: false },
      migrationPerformResponse: { migrated: ["anthropic"] },
    });
    // Simulate server-side state transition after perform.
    const originalFetch = globalThis.fetch;
    const patched = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/settings/migration-perform") && init?.method === "POST") {
        pending = false;
      }
      return originalFetch(input, init);
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = patched as unknown as typeof fetch;

    try {
      const { container, root, act } = await renderModal();

      const migrate = document.querySelector(
        "[data-testid='migration-migrate']",
      ) as HTMLButtonElement;
      expect(migrate).toBeTruthy();

      await act(async () => {
        migrate.click();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });

      const performed = fetchHandle.calls.some(
        (c) => c.url.endsWith("/api/settings/migration-perform") && c.init?.method === "POST",
      );
      expect(performed).toBe(true);

      const banner = document.querySelector("[data-testid='migration-banner']");
      expect(banner).toBeNull();

      act(() => root.unmount());
      container.remove();
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
      fetchHandle.restore();
    }
  });

  it("clicking Dismiss POSTs to /api/settings/migration-acknowledge and hides the banner", async () => {
    const fetchHandle = installFetchMock({
      migrationStatus: { pending: true, darwinKeys: ["anthropic"] },
      migrationAckResponse: { ok: true },
    });
    try {
      const { container, root, act } = await renderModal();

      const dismiss = document.querySelector(
        "[data-testid='migration-dismiss']",
      ) as HTMLElement;
      expect(dismiss).toBeTruthy();

      await act(async () => {
        (dismiss as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 0));
      });

      const acked = fetchHandle.calls.some(
        (c) => c.url.endsWith("/api/settings/migration-acknowledge") && c.init?.method === "POST",
      );
      expect(acked).toBe(true);

      const banner = document.querySelector("[data-testid='migration-banner']");
      expect(banner).toBeNull();

      act(() => root.unmount());
      container.remove();
    } finally {
      fetchHandle.restore();
    }
  });
});
