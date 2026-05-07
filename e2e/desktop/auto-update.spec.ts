// ---------------------------------------------------------------------------
// 0830 US-009 — Release-manager smoke test for end-to-end auto-update flow.
//
// AC coverage in this file:
//   - AC-US9-01 (manifest scaffolding):     covered by ./fixtures/manifest-server.ts
//                                           (not actively booted in v1; see below)
//   - AC-US9-02 (happy path):               "AC-US9-02 happy path" test below
//   - AC-US9-03 (post-relaunch up-to-date): asserted via the relaunch-simulation
//                                           step of the AC-US9-02 happy path
//   - AC-US9-04 (darwin-arm64 only):        test.skip(process.platform !== 'darwin')
//   - AC-US9-05 (signature mismatch):       "AC-US9-05 signature mismatch" test
//   - AC-US9-06 (debug-build flow isolated
//                from production signing):  see architectural-choice block below
//
// ARCHITECTURAL CHOICE — HTTP-MOCK + INJECTED TAURI BRIDGE (not native driver)
//
//   The Preferences UI ships as a Vite-built React bundle at
//   `dist/eval-ui/preferences.html`, served by the eval-server at
//   `http://localhost:3077/preferences.html` during e2e runs. The bundle's
//   `useDesktopBridge` hook detects the desktop runtime by probing
//   `window.__TAURI_INTERNALS__` synchronously (see
//   `src/eval-ui/src/preferences/lib/useDesktopBridge.ts`).
//
//   We use Playwright's `page.addInitScript()` to inject `__TAURI_INTERNALS__`
//   with a stubbed `invoke()` BEFORE the React bundle parses, so the bundle
//   takes the desktop code-path and dispatches every Tauri command (
//   `get_settings`, `check_for_update`, `install_update_and_restart`, etc.)
//   through our stub.
//
//   This isolates the *update flow* (UI states, status strings, dialog
//   transitions, signature-mismatch UX) from the *native binary replacement*
//   — exactly per AC-US9-06, which calls out that production signing is
//   exercised by the 0829 release pipeline and this spec is for the flow.
//
//   The native-driver alternative (tauri-driver + webdriverio against
//   `cargo tauri build --debug`) was considered and is what AC-US9-04 will
//   require for cross-OS coverage in a follow-on increment. macOS WKWebView
//   does not expose CDP, so Playwright cannot drive the native shell directly
//   on darwin in v1.
//
//   `./fixtures/manifest-server.ts` is included as **scaffolding** so a
//   future native-driver port has the latest.json shapes ready to import.
//   The v1 spec does NOT boot it — IPC stubs return the manifest data inline.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

// AC-US9-04: darwin-arm64 only in v1.
test.skip(process.platform !== "darwin", "0830 US-009 AC-US9-04: darwin-only in v1");

interface UpdateInfoStub {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface SettingsSnapshotStub {
  version: number;
  general: {
    theme: "system" | "light" | "dark";
    language: string;
    defaultProjectFolder: string | null;
    launchAtLogin: boolean;
  };
  updates: {
    channel: "stable" | "beta";
    autoCheck: boolean;
    lastCheckedAt: string | null;
    lastKnownVersion: string | null;
    skippedVersion: string | null;
    snoozedUntil: string | null;
  };
  privacy: {
    telemetryEnabled: boolean;
    crashReportingEnabled: boolean;
  };
  advanced: { logLevel: "error" | "warn" | "info" | "debug" | "trace" };
}

function defaultSettings(version: string): SettingsSnapshotStub {
  return {
    version: 1,
    general: {
      theme: "light",
      language: "en",
      defaultProjectFolder: null,
      launchAtLogin: false,
    },
    updates: {
      channel: "stable",
      autoCheck: true,
      lastCheckedAt: null,
      lastKnownVersion: version,
      skippedVersion: null,
      snoozedUntil: null,
    },
    privacy: { telemetryEnabled: false, crashReportingEnabled: false },
    advanced: { logLevel: "info" },
  };
}

interface BridgeStubConfig {
  /** Current version reported by `get_app_metadata`. */
  currentVersion: string;
  /** What `check_for_update` returns. */
  checkResult: UpdateInfoStub;
  /** What `install_update_and_restart` does. `null` = resolves; string = rejects with that message. */
  installRejectsWith: string | null;
}

/**
 * One-time install of the `__TAURI_INTERNALS__` shim. The shim reads its
 * behaviour-config dynamically from `window.__BRIDGE_CONFIG__`, which the
 * test re-seeds on every navigation via {@link seedBridgeConfig}. This lets
 * us "relaunch on a new version" by reloading with a fresh config without
 * the per-navigation `addInitScript` queue piling up stale shims.
 */
async function installBridgeShimOnce(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Calls = { cmd: string; args?: Record<string, unknown> }[];
    const w = window as unknown as Window & {
      __BRIDGE_CONFIG__?: {
        config: {
          currentVersion: string;
          checkResult: {
            available: boolean;
            currentVersion: string;
            latestVersion?: string;
            releaseNotes?: string;
            releaseDate?: string;
          };
          installRejectsWith: string | null;
        };
        settings: Record<string, unknown>;
      };
      __BRIDGE_CALLS__?: Calls;
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };

    w.__BRIDGE_CALLS__ = [];

    function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
      const parts = path.split(".");
      let cursor: Record<string, unknown> = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[parts[parts.length - 1]] = value;
    }

    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      const cfg = w.__BRIDGE_CONFIG__;
      // If the test forgot to seed config, fall through with no-ops rather
      // than throwing — surfaces as "(unknown)" in the UI which is debuggable.
      if (!cfg) return undefined;
      w.__BRIDGE_CALLS__!.push({ cmd, args });
      switch (cmd) {
        case "get_settings":
          return cfg.settings;
        case "set_setting": {
          const { path, value } = (args ?? {}) as { path: string; value: unknown };
          setNested(cfg.settings, path, value);
          return undefined;
        }
        case "reset_settings":
          return undefined;
        case "get_app_metadata":
          return {
            version: cfg.config.currentVersion,
            build: "debug",
            commit: "test-fixture",
            target: "aarch64-apple-darwin",
            arch: "aarch64",
          };
        case "check_for_update":
          (cfg.settings as { updates: { lastCheckedAt: string | null } }).updates.lastCheckedAt =
            new Date().toISOString();
          return cfg.config.checkResult;
        case "install_update_and_restart":
          if (cfg.config.installRejectsWith) {
            throw new Error(cfg.config.installRejectsWith);
          }
          return undefined;
        case "cancel_update_check":
        case "open_preferences":
        case "set_autostart":
        case "pick_default_project_folder":
        case "open_logs_folder":
        case "reveal_settings_file":
        case "copy_settings_path":
          return null;
        default:
          return undefined;
      }
    };

    w.__TAURI_INTERNALS__ = { invoke };
  });
}

/**
 * Re-seed the shim's behaviour-config. Must be called BEFORE each navigation
 * (via `addInitScript` again, since `window.__BRIDGE_CONFIG__` resets on
 * navigation). We wrap it as an init script so the bundle sees the config
 * synchronously before the React app calls `useState(detectMode)`.
 */
async function seedBridgeConfig(page: Page, cfg: BridgeStubConfig): Promise<void> {
  await page.addInitScript(
    ([config, settings]) => {
      (
        window as unknown as {
          __BRIDGE_CONFIG__?: {
            config: typeof config;
            settings: typeof settings;
          };
        }
      ).__BRIDGE_CONFIG__ = { config, settings };
    },
    [cfg, defaultSettings(cfg.currentVersion)] as const,
  );
}

async function getBridgeCalls(page: Page): Promise<{ cmd: string; args?: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __BRIDGE_CALLS__: { cmd: string; args?: Record<string, unknown> }[] })
        .__BRIDGE_CALLS__ ?? [],
  );
}

async function openUpdatesTab(page: Page): Promise<void> {
  await page.goto("/preferences.html#updates");
  // The Preferences sidebar is the first thing rendered; the Updates tab is
  // selected via the URL hash. Wait for the heading.
  await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("0830 US-009 — Skill Studio auto-update smoke test", () => {
  test.beforeEach(async ({ page }) => {
    await installBridgeShimOnce(page);
  });

  test("AC-US9-02 / AC-US9-03 / AC-US9-06: happy path — check, install, relaunch shows up-to-date", async ({
    page,
  }) => {
    // ----- Phase 1: v0.1.0 with a v0.2.0 update available --------------------
    await seedBridgeConfig(page, {
      currentVersion: "0.1.0",
      checkResult: {
        available: true,
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        releaseNotes: "Test release notes for the desktop auto-update smoke spec.",
        releaseDate: "2026-05-07T00:00:00Z",
      },
      installRejectsWith: null,
    });

    await openUpdatesTab(page);

    // Current version row must read "0.1.0" before the check.
    const currentVersionValue = page
      .locator(".pref-meta-row", { hasText: "Current version" })
      .locator(".pref-meta-row__value");
    await expect(currentVersionValue).toContainText("0.1.0", { timeout: 5_000 });

    // Click "Check for updates".
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();

    // AC-US9-02: status row shows "Update available: 0.2.0".
    // (The i18n template is `Update available: {{version}}` — 0.2.0 is the
    // unprefixed semver returned by check_for_update; the spec-text says
    // "v0.2.0" but the actual translation has no leading "v".)
    const statusRow = page.locator(".pref-status-row").first();
    await expect(statusRow).toContainText("Update available: 0.2.0", { timeout: 5_000 });

    // The update dialog opens automatically.
    const dialog = page.getByRole("dialog", { name: "Update available" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText("0.2.0");
    await expect(dialog).toContainText(
      "Test release notes for the desktop auto-update smoke spec.",
    );

    // Click "Install now" (the actual i18n label — the spec's "Install &
    // Restart" is conceptual; the real button reads "Install now" pre-install
    // and "Restart now" post-install).
    await dialog.getByRole("button", { name: "Install now" }).click();

    // The IPC `install_update_and_restart` resolves; the dialog moves to
    // "ready-to-restart" and shows the "Restart now" button.
    await expect(dialog.getByRole("button", { name: "Restart now" })).toBeVisible({
      timeout: 5_000,
    });

    // Verify the install IPC was called exactly once.
    const callsAfterInstall = await getBridgeCalls(page);
    const installCalls = callsAfterInstall.filter((c) => c.cmd === "install_update_and_restart");
    expect(installCalls.length).toBe(1);

    // ----- Phase 2: simulate the relaunch on v0.2.0 --------------------------
    // In production, `tauri-plugin-updater` exits the process and relaunches
    // the new bundle. For the HTTP-mock approach, we re-seed the shim's
    // behaviour config so that on the next navigation, `get_app_metadata`
    // returns the new version and `check_for_update` reports up-to-date.
    // `addInitScript`s accumulate in registration order on every new
    // document, so the latest-registered config wins — exactly what we want.
    await seedBridgeConfig(page, {
      currentVersion: "0.2.0",
      checkResult: {
        available: false,
        currentVersion: "0.2.0",
      },
      installRejectsWith: null,
    });

    // Use page.reload() rather than goto(same URL with hash) — fragment-only
    // navigations don't re-run addInitScript. reload() always does.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Updates" })).toBeVisible({
      timeout: 5_000,
    });

    // AC-US9-03: current version now reads 0.2.0.
    const currentVersionAfter = page
      .locator(".pref-meta-row", { hasText: "Current version" })
      .locator(".pref-meta-row__value");
    await expect(currentVersionAfter).toContainText("0.2.0", { timeout: 5_000 });

    // Click "Check for updates" again.
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();

    // Status row now reads "Skill Studio is up to date."
    const statusAfter = page.locator(".pref-status-row").first();
    await expect(statusAfter).toContainText("Skill Studio is up to date.", { timeout: 5_000 });

    // No update dialog this time.
    await expect(page.getByRole("dialog", { name: "Update available" })).toHaveCount(0);
  });

  test("AC-US9-05: negative path — bad signature surfaces 'signature invalid' and version stays at 0.1.0", async ({
    page,
  }) => {
    await seedBridgeConfig(page, {
      currentVersion: "0.1.0",
      checkResult: {
        available: true,
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        releaseNotes: "Test release with WRONG signing key (negative path fixture).",
      },
      // Match the structured error shape `tauri-plugin-updater` raises when
      // minisign verification fails. The UI's `detectErrorKind()` matches on
      // the substring "signature".
      installRejectsWith: "Update signature invalid — refusing to install",
    });

    await openUpdatesTab(page);

    // Pre-condition: current version 0.1.0.
    const currentVersionValue = page
      .locator(".pref-meta-row", { hasText: "Current version" })
      .locator(".pref-meta-row__value");
    await expect(currentVersionValue).toContainText("0.1.0", { timeout: 5_000 });

    // Click "Check for updates".
    await page.getByRole("button", { name: "Check for updates", exact: true }).click();

    // Update dialog opens (check itself succeeds).
    const dialog = page.getByRole("dialog", { name: "Update available" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click Install — this rejects with the signature error.
    await dialog.getByRole("button", { name: "Install now" }).click();

    // The dialog should close (UpdatesTab sets dialog.open=false on error).
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // The status row in the page reflects the i18n-translated signature error.
    const statusRow = page.locator(".pref-status-row").first();
    await expect(statusRow).toContainText("Update signature invalid — refusing to install.", {
      timeout: 5_000,
    });

    // The "View logs" + "Try again" recovery buttons are now visible (rendered
    // when checkState === "error").
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View logs" })).toBeVisible();

    // Version stayed at 0.1.0 — no relaunch was attempted.
    await expect(currentVersionValue).toContainText("0.1.0");

    // No second `install_update_and_restart` was attempted (the user has to
    // click Try again first; this test doesn't simulate that retry).
    const calls = await getBridgeCalls(page);
    const installCalls = calls.filter((c) => c.cmd === "install_update_and_restart");
    expect(installCalls.length).toBe(1);
  });
});
