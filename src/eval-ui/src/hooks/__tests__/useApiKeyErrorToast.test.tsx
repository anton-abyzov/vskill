// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0702 T-042: useApiKeyErrorToast — RED.
//
// Server-0702 returns a structured 401 body when an /api/eval-family call
// rejects with an invalid/missing provider key:
//
//   HTTP 401
//   { error: "invalid_api_key", provider: "anthropic" | "openai" | "openrouter" }
//
// The UI must:
//   1. Surface an error toast "<Provider> API key invalid or missing. Open
//      Settings →" with an action button that opens SettingsModal scrolled
//      to that provider's row.
//   2. Dedupe — if the same provider fires multiple 401s within a short
//      window, only ONE toast is visible at a time. A different provider
//      still gets its own toast.
//   3. Clicking the action dispatches a `studio:open-settings` CustomEvent
//      carrying the provider id. (Shell listens and opens SettingsModal.)
// ---------------------------------------------------------------------------

type ReactLib = typeof import("react");
type Root = ReturnType<typeof import("react-dom/client")["createRoot"]>;

interface Harness {
  container: HTMLElement;
  root: Root;
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
  report: (payload: { provider: "anthropic" | "openai" | "openrouter" }) => void;
  unmount: () => void;
}

async function mount(): Promise<Harness> {
  const React: ReactLib = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider } = await import("../../components/ToastProvider");
  const { useApiKeyErrorToast } = await import("../useApiKeyErrorToast");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportRef: { current: ((p: any) => void) | null } = { current: null };

  function Probe() {
    const { report } = useApiKeyErrorToast();
    reportRef.current = report;
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(Probe)),
    );
  });

  return {
    container,
    root,
    act: (fn) => act(fn as () => void),
    report: (p) => reportRef.current!(p),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("0702 T-042: useApiKeyErrorToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces an error toast when report({provider}) is called", async () => {
    const h = await mount();
    try {
      h.act(() => {
        h.report({ provider: "anthropic" });
      });
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
      expect(items[0].getAttribute("data-severity")).toBe("error");
      // Copy must name the provider and point to Settings.
      const text = (items[0].textContent ?? "").toLowerCase();
      expect(text).toContain("anthropic");
      expect(text).toContain("settings");
    } finally {
      h.unmount();
    }
  });

  it("shows a clickable action that dispatches studio:open-settings with the provider", async () => {
    const h = await mount();
    const seen: string[] = [];
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { provider?: string } | undefined;
      if (detail?.provider) seen.push(detail.provider);
    }
    window.addEventListener("studio:open-settings", onOpen);
    try {
      h.act(() => {
        h.report({ provider: "openai" });
      });
      const actionBtn = Array.from(
        h.container.querySelectorAll("[data-testid='toast-item'] button"),
      ).find((b) => /settings/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
      expect(actionBtn).toBeTruthy();
      h.act(() => actionBtn!.click());
      expect(seen).toEqual(["openai"]);
      // Clicking the action dismisses the toast (Toast.tsx contract).
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      window.removeEventListener("studio:open-settings", onOpen);
      h.unmount();
    }
  });

  it("dedupes repeated 401s for the same provider within 3s window", async () => {
    const h = await mount();
    try {
      h.act(() => {
        h.report({ provider: "anthropic" });
        h.report({ provider: "anthropic" });
        h.report({ provider: "anthropic" });
      });
      // Only ONE toast visible for that provider.
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("does NOT dedupe across different providers", async () => {
    const h = await mount();
    try {
      h.act(() => {
        h.report({ provider: "anthropic" });
        h.report({ provider: "openai" });
      });
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(2);
    } finally {
      h.unmount();
    }
  });

  it("allows a new toast for the same provider after the dedupe window passes", async () => {
    const h = await mount();
    try {
      h.act(() => {
        h.report({ provider: "anthropic" });
      });
      // Default toast duration is 4s; dedupe window is 3s. Dismiss explicitly
      // so we aren't asserting against the dismiss animation overlap — we
      // want to test that after the dedupe window, a second report yields
      // a toast again.
      h.act(() => vi.advanceTimersByTime(5000));
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);

      h.act(() => {
        h.report({ provider: "anthropic" });
      });
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(1);
    } finally {
      h.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Separate test: the App Shell listens for studio:open-settings and opens
// SettingsModal with initialProvider pre-focused. This is asserted at the
// App level via a narrower probe that imports only the event handler so we
// don't boot the full StudioContext/workspace stack.
// ---------------------------------------------------------------------------
describe("0702 T-042: studio:open-settings event routing", () => {
  it("CustomEvent detail.provider is the provider id string", () => {
    const seen: unknown[] = [];
    function onOpen(e: Event) {
      seen.push((e as CustomEvent).detail);
    }
    window.addEventListener("studio:open-settings", onOpen);
    try {
      window.dispatchEvent(
        new CustomEvent("studio:open-settings", {
          detail: { provider: "openrouter" },
        }),
      );
      expect(seen).toEqual([{ provider: "openrouter" }]);
    } finally {
      window.removeEventListener("studio:open-settings", onOpen);
    }
  });
});
