// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RawHandler = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, RawHandler>,
  bridge: {
    available: true,
    getAppMetadata: vi.fn(() =>
      Promise.resolve({
        version: "1.0.0",
        build: "debug",
        commit: "test",
        target: "darwin",
        arch: "arm64",
      }),
    ),
    getSettings: vi.fn(() =>
      Promise.resolve({
        updates: {
          autoCheck: true,
          lastCheckedAt: null,
          skippedVersion: null,
          snoozedUntil: null,
        },
      }),
    ),
    checkForUpdates: vi.fn(() =>
      Promise.resolve({
        available: true,
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        releaseNotes: "Desktop update notes.",
      }),
    ),
    downloadAndInstallUpdate: vi.fn(async (onProgress?: (bytes: number, total: number) => void) => {
      onProgress?.(100, 100);
    }),
    restartApp: vi.fn(() => Promise.resolve()),
    openPreferences: vi.fn(() => Promise.resolve()),
  },
  listenTauriEvent: vi.fn((name: string, cb: RawHandler) => {
    mocks.handlers[name] = cb;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  useDesktopBridge: () => mocks.bridge,
  listenTauriEvent: mocks.listenTauriEvent,
  normalizeUpdateInfo: (
    raw: {
      available?: boolean;
      currentVersion?: string;
      latestVersion?: string;
      releaseNotes?: string;
      version?: string | null;
      notes?: string | null;
    },
    currentVersion: string,
  ) => ({
    available: raw.available === true,
    currentVersion: raw.currentVersion ?? currentVersion,
    latestVersion: raw.latestVersion ?? raw.version ?? undefined,
    releaseNotes: raw.releaseNotes ?? raw.notes ?? undefined,
  }),
}));

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function mount(children?: "with-pill") {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdateBanner } = await import("../UpdateBanner");
  const { AppUpdateButton } = await import("../AppUpdateButton");
  const { AppUpdaterProvider } = await import("../../hooks/useAppUpdater");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        AppUpdaterProvider,
        null,
        React.createElement(UpdateBanner),
        children === "with-pill" ? React.createElement(AppUpdateButton) : null,
      ),
    );
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UpdateBanner", () => {
  afterEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mocks.handlers)) delete mocks.handlers[k];
  });

  it("renders a full-width banner with the version and an Update now action", async () => {
    const h = await mount();
    try {
      await h.act(flush);
      const banner = h.container.querySelector("[data-testid='app-update-banner']");
      expect(banner).toBeTruthy();
      expect(h.container.textContent).toContain("Skill Studio 1.0.1 is available");
      const action = h.container.querySelector(
        "[data-testid='app-update-banner-action']",
      ) as HTMLButtonElement;
      expect(action.textContent).toBe("Update now");
    } finally {
      h.unmount();
    }
  });

  it("downloads, installs, and restarts from one click", async () => {
    const h = await mount();
    try {
      await h.act(flush);
      const action = h.container.querySelector(
        "[data-testid='app-update-banner-action']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        action.click();
        await flush();
      });
      expect(mocks.bridge.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.bridge.restartApp).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("keeps a failed install visible and retryable", async () => {
    mocks.bridge.downloadAndInstallUpdate.mockRejectedValueOnce(new Error("signature mismatch"));
    const h = await mount();
    try {
      await h.act(flush);
      const action = h.container.querySelector(
        "[data-testid='app-update-banner-action']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        action.click();
        await flush();
      });
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeTruthy();
      expect(h.container.querySelector("[data-testid='app-update-banner-error']")?.textContent)
        .toContain("signature mismatch");
      const retry = h.container.querySelector(
        "[data-testid='app-update-banner-action']",
      ) as HTMLButtonElement;
      expect(retry.disabled).toBe(false);
      expect(mocks.bridge.restartApp).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("renders nothing when no update is available", async () => {
    mocks.bridge.checkForUpdates.mockResolvedValueOnce({
      available: false,
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      releaseNotes: "",
    });
    const h = await mount();
    try {
      await h.act(flush);
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("dismiss hides the banner but keeps the compact pill (AC-US3-01)", async () => {
    const h = await mount("with-pill");
    try {
      await h.act(flush);
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeTruthy();
      expect(h.container.querySelector("[data-testid='app-update-header-button']")).toBeTruthy();

      const dismiss = h.container.querySelector(
        "[data-testid='app-update-banner-dismiss']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        dismiss.click();
        await flush();
      });

      // Banner gone, pill stays.
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeNull();
      expect(h.container.querySelector("[data-testid='app-update-header-button']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("re-shows the banner when a newer version arrives after dismiss (AC-US3-03)", async () => {
    const h = await mount();
    try {
      await h.act(flush);
      const dismiss = h.container.querySelector(
        "[data-testid='app-update-banner-dismiss']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        dismiss.click();
        await flush();
      });
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeNull();

      // A newer version pushed via the ambient updater://available event.
      await h.act(async () => {
        mocks.handlers["updater://available"]?.({
          payload: { available: true, latestVersion: "1.0.2", releaseNotes: "Even newer." },
        });
        await flush();
      });
      expect(h.container.querySelector("[data-testid='app-update-banner']")).toBeTruthy();
      expect(h.container.textContent).toContain("Skill Studio 1.0.2 is available");
    } finally {
      h.unmount();
    }
  });
});
