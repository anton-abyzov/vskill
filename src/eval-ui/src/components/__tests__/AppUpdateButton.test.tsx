// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
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
  listenTauriEvent: vi.fn(() => Promise.resolve(null)),
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

async function mountButton() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { AppUpdaterProvider } = await import("../../hooks/useAppUpdater");
  const { AppUpdateButton } = await import("../AppUpdateButton");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        AppUpdaterProvider,
        null,
        React.createElement(AppUpdateButton),
      ),
    );
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) =>
      act(async () => {
        await fn();
      }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("AppUpdateButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a top-rail update action after the background check finds an app update", async () => {
    const h = await mountButton();
    try {
      await h.act(flush);
      const button = h.container.querySelector(
        "[data-testid='app-update-header-button']",
      ) as HTMLButtonElement;
      expect(button).toBeTruthy();
      expect(button.textContent).toContain("Update");
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("downloads, installs, and restarts from one header click", async () => {
    const h = await mountButton();
    try {
      await h.act(flush);
      const button = h.container.querySelector(
        "[data-testid='app-update-header-button']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        button.click();
        await flush();
      });
      expect(mocks.bridge.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.bridge.restartApp).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("keeps a failed install visible and retryable", async () => {
    mocks.bridge.downloadAndInstallUpdate.mockRejectedValueOnce(
      new Error("signature mismatch"),
    );
    const h = await mountButton();
    try {
      await h.act(flush);
      const button = h.container.querySelector(
        "[data-testid='app-update-header-button']",
      ) as HTMLButtonElement;
      await h.act(async () => {
        button.click();
        await flush();
      });
      const retry = h.container.querySelector(
        "[data-testid='app-update-header-button']",
      ) as HTMLButtonElement;
      expect(retry.textContent).toContain("Update failed");
      expect(retry.title).toContain("signature mismatch");
      expect(retry.disabled).toBe(false);
      expect(mocks.bridge.restartApp).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
});
