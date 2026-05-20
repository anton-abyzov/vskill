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
        updates: { autoCheck: true, lastCheckedAt: null },
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

async function mountToast() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { AppUpdateToast } = await import("../AppUpdateToast");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AppUpdateToast));
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("AppUpdateToast", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the whole-app update and wires install to real restart", async () => {
    const h = await mountToast();
    try {
      await h.act(flush);
      expect(h.container.querySelector("[data-testid='app-update-toast']")).toBeTruthy();
      expect(h.container.textContent).toContain("Skill Studio 1.0.1 is available");

      const install = h.container.querySelector(
        "[data-testid='app-update-install']",
      ) as HTMLButtonElement;
      await h.act(() => {
        install.click();
      });
      expect(mocks.bridge.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);

      const restart = h.container.querySelector(
        "[data-testid='app-update-restart']",
      ) as HTMLButtonElement;
      expect(restart).toBeTruthy();
      await h.act(() => {
        restart.click();
      });
      expect(mocks.bridge.restartApp).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});
