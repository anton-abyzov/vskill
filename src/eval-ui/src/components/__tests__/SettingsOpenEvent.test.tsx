// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0702 T-042 integration: end-to-end 401 → toast → click → SettingsModal.
//
// Mounts ToastProvider + useApiKeyErrorToast + a mock shell that listens for
// studio:open-settings and renders SettingsModal. Asserts the user-observable
// flow stitches together correctly — the seam between SSE dispatch and the
// ultimate SettingsModal mount.
// ---------------------------------------------------------------------------

type ReactLib = typeof import("react");
type Root = ReturnType<typeof import("react-dom/client")["createRoot"]>;

describe("0702 T-042: end-to-end 401 → toast → click → SettingsModal", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // /api/settings/keys (SettingsModal on-mount refresh).
    // /api/settings/storage-path (SettingsModal on-open fetch).
    // /api/settings/migration-status (MigrationBanner on-mount fetch).
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings/keys")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              anthropic: { stored: false, updatedAt: null },
              openai: { stored: false, updatedAt: null },
              openrouter: { stored: false, updatedAt: null },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/settings/storage-path")) {
        return Promise.resolve(
          new Response(JSON.stringify({ path: "/tmp/.vskill/keys.env" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/settings/migration-status")) {
        return Promise.resolve(
          new Response(JSON.stringify({ pending: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatching studio:api-key-error then clicking Open Settings opens SettingsModal focused on that provider", async () => {
    const React: ReactLib = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ToastProvider } = await import("../ToastProvider");
    const { useApiKeyErrorToast } = await import("../../hooks/useApiKeyErrorToast");
    const { SettingsModal } = await import("../SettingsModal");

    function Shell() {
      useApiKeyErrorToast();
      const [open, setOpen] = React.useState(false);
      const [provider, setProvider] = React.useState<
        "anthropic" | "openai" | "openrouter" | undefined
      >(undefined);
      React.useEffect(() => {
        function onOpen(e: Event) {
          const detail = (e as CustomEvent).detail as
            | { provider?: "anthropic" | "openai" | "openrouter" }
            | undefined;
          setProvider(detail?.provider);
          setOpen(true);
        }
        window.addEventListener("studio:open-settings", onOpen);
        return () => window.removeEventListener("studio:open-settings", onOpen);
      }, []);
      return React.createElement(SettingsModal, {
        open,
        onClose: () => setOpen(false),
        initialProvider: provider,
      });
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(ToastProvider, null, React.createElement(Shell)),
      );
    });

    try {
      // 1. Simulate the SSE 401 dispatch.
      act(() => {
        window.dispatchEvent(
          new CustomEvent("studio:api-key-error", {
            detail: { provider: "openai" },
          }),
        );
      });

      // 2. A toast with an Open Settings action appears.
      const items = container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
      const actionBtn = Array.from(items[0].querySelectorAll("button")).find((b) =>
        /settings/i.test(b.textContent ?? ""),
      ) as HTMLButtonElement | undefined;
      expect(actionBtn).toBeTruthy();

      // 3. Click it — dispatches studio:open-settings, Shell opens SettingsModal.
      await act(async () => {
        actionBtn!.click();
        // Flush microtasks so the SettingsModal's fetch useEffects settle.
        await Promise.resolve();
        await Promise.resolve();
      });

      const modal = container.querySelector("[data-testid='settings-modal']");
      expect(modal).toBeTruthy();
      // The OpenAI provider row is present (T-050 wiring), which is the row
      // SettingsModal focuses when initialProvider === "openai".
      expect(container.querySelector("[data-testid='provider-row-openai']")).toBeTruthy();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
