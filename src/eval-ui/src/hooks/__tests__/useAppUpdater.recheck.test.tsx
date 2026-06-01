// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
        updates: { autoCheck: true, lastCheckedAt: null, skippedVersion: null, snoozedUntil: null },
      }),
    ),
    checkForUpdates: vi.fn(() =>
      Promise.resolve({
        available: true,
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        releaseNotes: "Notes.",
      }),
    ),
    downloadAndInstallUpdate: vi.fn(() => Promise.resolve()),
    restartApp: vi.fn(() => Promise.resolve()),
    openPreferences: vi.fn(() => Promise.resolve()),
  },
  listenTauriEvent: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  useDesktopBridge: () => mocks.bridge,
  listenTauriEvent: mocks.listenTauriEvent,
  normalizeUpdateInfo: (
    raw: { available?: boolean; latestVersion?: string; version?: string | null },
    currentVersion: string,
  ) => ({
    available: raw.available === true,
    currentVersion,
    latestVersion: raw.latestVersion ?? raw.version ?? undefined,
    releaseNotes: undefined,
  }),
}));

const MIN = 60 * 1000;
let now = 0;
const intervalCbs: Array<() => void> = [];

beforeEach(() => {
  now = 0;
  intervalCbs.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(globalThis, "setInterval").mockImplementation(((cb: () => void) => {
    intervalCbs.push(cb);
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function mountProvider() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { AppUpdaterProvider } = await import("../useAppUpdater");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AppUpdaterProvider, null, React.createElement("div")));
    await flush();
  });
  return {
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useAppUpdater foreground re-check", () => {
  it("checks on mount, throttles within 30min, and re-checks after the window (AC-US1-01/03)", async () => {
    const h = await mountProvider();
    try {
      await h.act(flush);
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(1); // mount check, stamped at t=0

      // Focus 10 min later — throttled.
      now = 10 * MIN;
      await h.act(async () => {
        window.dispatchEvent(new Event("focus"));
        await flush();
      });
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(1);

      // Focus 40 min after the last check — re-checks.
      now = 40 * MIN;
      await h.act(async () => {
        window.dispatchEvent(new Event("focus"));
        await flush();
      });
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      h.unmount();
    }
  });

  it("re-checks when the tab becomes visible after the throttle window", async () => {
    const h = await mountProvider();
    try {
      await h.act(flush);
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(1);

      now = 31 * MIN;
      await h.act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await flush();
      });
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      h.unmount();
    }
  });

  it("re-checks on the foreground interval (AC-US1-02)", async () => {
    const h = await mountProvider();
    try {
      await h.act(flush);
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(intervalCbs.length).toBeGreaterThan(0);

      // Interval fires an hour later — past the throttle window.
      now = 60 * MIN;
      await h.act(async () => {
        intervalCbs[0]();
        await flush();
      });
      expect(mocks.bridge.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      h.unmount();
    }
  });
});
