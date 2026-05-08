// ---------------------------------------------------------------------------
// 0833 pivot — sign-in + paywall flow smoke test.
//
// (Originally 0831 T-028; rewritten for the 0833 trigger pivot. The
// paywall used to fire on the 51st skill create; it now fires on a free
// user attempting to connect a private repo. The test drives the flow by
// dispatching `studio:request-paywall` on `window` — exactly the same
// event ConnectedRepoWidget will dispatch when the widget mount lands.)
//
// Owner: desktop-quota-agent.
//
// Coverage:
//   - AC-US2-02:    paywall fires on private-repo connect intent
//   - AC-US2-03:    new modal copy ("Connect private repositories with
//                   Skill Studio Pro" + "Pro adds private repo
//                   connections, priority support, and unlimited skills.")
//   - AC-US2-06:    Pro tier short-circuits — no modal
//   - AC-US7-02:    "Upgrade" button opens https://verified-skill.com/pricing
//                   via the openExternalUrl IPC stub
//
// Architecture (mirrors auto-update.spec.ts):
//   - Inject `__TAURI_INTERNALS__` shim BEFORE the React bundle parses.
//   - Stub IPCs: get_settings, start/poll_github_device_flow,
//                get_signed_in_user, sign_out, quota_get, quota_force_sync,
//                quota_can_create_skill, quota_report_count,
//                open_external_url, get_repo_info,
//                pick_default_project_folder, get_app_metadata,
//                check_for_updates, set_setting, reset_settings.
//   - Walk: sign in (default state) → dispatch private-repo connect →
//     paywall modal with new copy → click "Upgrade" → assert
//     openExternalUrl was called with the canonical pricing URL.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

interface BridgeCall {
  cmd: string;
  args?: Record<string, unknown>;
}

interface BridgeFixture {
  /** Returns the IPCs invoked since the page loaded. */
  calls: () => Promise<BridgeCall[]>;
  /** Clear the recorded call log without touching state. */
  clearCalls: () => Promise<void>;
}

const PRICING_URL = "https://verified-skill.com/pricing";

/**
 * Install a Tauri-internals shim BEFORE the React bundle boots so
 * `useDesktopBridge` takes the desktop code path. The shim's behavior is
 * driven by `window.__BRIDGE_STATE__` which the test mutates via
 * `page.evaluate` between assertions.
 */
async function installBridgeShim(page: Page): Promise<BridgeFixture> {
  await page.addInitScript(() => {
    type Calls = { cmd: string; args?: Record<string, unknown> }[];

    interface State {
      // Auth
      pendingDeviceFlow: boolean;
      signedIn: boolean;
      pollOutcomes: string[]; // sequence the poll IPC walks each call
      // Quota
      tier: "free" | "pro" | "enterprise";
      skillCount: number;
      skillLimit: number | null;
      // openExternalUrl invocation tracker
      lastOpenedUrl: string | null;
      // For force-sync race resolution: whether the next force_sync should
      // flip the tier to "pro" mid-paywall.
      flipToProOnForceSync: boolean;
    }

    const w = window as unknown as Window & {
      __BRIDGE_STATE__?: State;
      __BRIDGE_CALLS__?: Calls;
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };

    w.__BRIDGE_CALLS__ = [];
    w.__BRIDGE_STATE__ = {
      pendingDeviceFlow: false,
      signedIn: false,
      pollOutcomes: [],
      tier: "free",
      skillCount: 0,
      // 0833: free tier no longer has a count cap — `null` means unlimited.
      skillLimit: null,
      lastOpenedUrl: null,
      flipToProOnForceSync: false,
    };

    function nowIso(offsetMs = 0): string {
      const d = new Date(Date.now() + offsetMs);
      return d.toISOString();
    }

    function makeQuotaSnapshot() {
      const s = w.__BRIDGE_STATE__!;
      const serverNow = nowIso();
      const cache = s.signedIn
        ? {
            response: {
              tier: s.tier,
              skillCount: s.skillCount,
              skillLimit: s.skillLimit,
              lastSyncedAt: serverNow,
              gracePeriodDaysRemaining: 7,
              serverNow,
            },
            localAtSync: serverNow,
            clockSkewMs: 0,
          }
        : null;
      return {
        cache,
        localSkillCount: s.skillCount,
        isFresh: s.signedIn,
        daysRemaining: s.signedIn ? 7 : 0,
      };
    }

    const invoke = async (
      cmd: string,
      args?: Record<string, unknown>,
    ): Promise<unknown> => {
      const s = w.__BRIDGE_STATE__!;
      w.__BRIDGE_CALLS__!.push({ cmd, args });
      switch (cmd) {
        // --------- settings + metadata ----------
        case "get_settings":
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
              lastKnownVersion: "1.0.14",
              skippedVersion: null,
              snoozedUntil: null,
            },
            privacy: { telemetryEnabled: false, crashReportingEnabled: false },
            advanced: { logLevel: "info" },
            studio: { lifecycleDefault: "ask" },
          };
        case "set_setting":
          return undefined;
        case "reset_settings":
          return undefined;
        case "get_app_metadata":
          return {
            version: "1.0.14",
            build: "debug",
            commit: "test",
            target: "aarch64-apple-darwin",
            arch: "aarch64",
          };
        case "check_for_updates":
          return { available: false, currentVersion: "1.0.14" };

        // --------- auth ----------
        case "start_github_device_flow":
          s.pendingDeviceFlow = true;
          // Pre-load the poll-outcome script: the first poll returns
          // "pending"; the second returns the granted user identity. Tests
          // can override via __BRIDGE_STATE__.pollOutcomes if needed.
          if (s.pollOutcomes.length === 0) {
            s.pollOutcomes = ["pending", "granted"];
          }
          return {
            userCode: "WDJB-MJHT",
            verificationUri: "https://github.com/login/device",
            interval: 5,
            expiresIn: 900,
          };
        case "poll_github_device_flow": {
          if (!s.pendingDeviceFlow) {
            throw new Error("no-flow");
          }
          const next = s.pollOutcomes.shift() ?? "granted";
          if (next === "pending") {
            throw new Error("pending");
          }
          if (next === "denied") {
            s.pendingDeviceFlow = false;
            throw new Error("denied");
          }
          if (next === "expired") {
            s.pendingDeviceFlow = false;
            throw new Error("expired");
          }
          // granted
          s.pendingDeviceFlow = false;
          s.signedIn = true;
          return {
            login: "octocat",
            avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4",
            email: "octocat@github.com",
            cached_at: nowIso(),
          };
        }
        case "get_signed_in_user":
          return s.signedIn
            ? {
                login: "octocat",
                avatar_url:
                  "https://avatars.githubusercontent.com/u/583231?v=4",
                email: "octocat@github.com",
                cached_at: nowIso(),
              }
            : null;
        case "sign_out":
          s.signedIn = false;
          return undefined;
        case "refresh_user_identity":
          return s.signedIn
            ? {
                login: "octocat",
                avatar_url:
                  "https://avatars.githubusercontent.com/u/583231?v=4",
                email: "octocat@github.com",
                cached_at: nowIso(),
              }
            : null;

        // --------- folders ----------
        case "pick_default_project_folder":
          return null;
        case "get_repo_info":
          return {
            name: null,
            branch: null,
            is_private: null,
            sync_state: { kind: "no_remote" },
          };

        // --------- quota ----------
        case "quota_get":
          return makeQuotaSnapshot();
        case "quota_force_sync":
          if (s.flipToProOnForceSync) {
            s.tier = "pro";
            s.skillLimit = null;
          }
          return makeQuotaSnapshot();
        case "quota_can_create_skill": {
          // 0833 pivot: the IPC still exists but is no longer consulted
          // from the create flow. We mirror the new gate logic — `null`
          // limit returns ok regardless of count; explicit limits still
          // gate. Pro/Enterprise short-circuit.
          const snapshot = makeQuotaSnapshot();
          let blocked = false;
          let reason = "ok";
          if (s.tier === "free" && s.skillLimit !== null) {
            if (s.skillCount >= s.skillLimit) {
              blocked = true;
              reason = "limit-reached";
            }
          }
          return { blocked, reason, snapshot };
        }
        case "quota_report_count":
          return undefined;

        // --------- shell ----------
        case "open_external_url":
          s.lastOpenedUrl = (args?.url as string) ?? null;
          return undefined;

        default:
          return undefined;
      }
    };

    w.__TAURI_INTERNALS__ = { invoke };
  });

  return {
    calls: () =>
      page.evaluate(
        () =>
          ((window as unknown) as { __BRIDGE_CALLS__: BridgeCall[] })
            .__BRIDGE_CALLS__ ?? [],
      ),
    clearCalls: async () => {
      await page.evaluate(() => {
        (
          (window as unknown) as { __BRIDGE_CALLS__: BridgeCall[] }
        ).__BRIDGE_CALLS__ = [];
      });
    },
  };
}

async function setBridgeState(
  page: Page,
  patch: Partial<{
    tier: "free" | "pro" | "enterprise";
    skillCount: number;
    skillLimit: number | null;
    flipToProOnForceSync: boolean;
    pollOutcomes: string[];
  }>,
): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as { __BRIDGE_STATE__?: Record<string, unknown> };
    if (!w.__BRIDGE_STATE__) return;
    Object.assign(w.__BRIDGE_STATE__, p);
  }, patch);
}

async function getBridgeStateField<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const w = window as unknown as {
      __BRIDGE_STATE__?: Record<string, unknown>;
    };
    return (w.__BRIDGE_STATE__?.[k] ?? null) as T | null;
  }, key);
}

/**
 * 0833 pivot — drives the paywall via the `studio:request-paywall`
 * window event the App.tsx host listens for. ConnectedRepoWidget will
 * dispatch this event with the repo name when its mount lands; until
 * then the e2e dispatches it directly to exercise the runtime path.
 */
async function dispatchPrivateRepoConnect(
  page: Page,
  repoName = "anton-abyzov/private-fixture",
): Promise<void> {
  await page.evaluate((name) => {
    window.dispatchEvent(
      new CustomEvent("studio:request-paywall", { detail: { repoName: name } }),
    );
  }, repoName);
}

test.describe("0833 — auth + paywall (private-repo connect trigger)", () => {
  test("AC-US2-02/03 + AC-US7-02: paywall on private-repo connect → upgrade opens pricing", async ({
    page,
  }) => {
    await installBridgeShim(page);

    // Seed: signed in, free tier, no count cap (0833 default).
    await page.addInitScript(() => {
      const w = window as unknown as {
        __BRIDGE_STATE__?: {
          signedIn: boolean;
          tier: "free" | "pro" | "enterprise";
          skillCount: number;
          skillLimit: number | null;
        };
      };
      if (w.__BRIDGE_STATE__) {
        w.__BRIDGE_STATE__.signedIn = true;
        w.__BRIDGE_STATE__.tier = "free";
        w.__BRIDGE_STATE__.skillCount = 7;
        w.__BRIDGE_STATE__.skillLimit = null;
      }
    });

    await page.goto("/index.html");

    // Make sure the shell finished mounting so the App.tsx event listener
    // is wired before we dispatch.
    await expect(
      page.getByRole("button", { name: /new skill/i }),
    ).toBeVisible({ timeout: 10_000 });

    await dispatchPrivateRepoConnect(page);

    // Paywall must appear with the new copy (AC-US2-03).
    const paywall = page.getByTestId("paywall-modal");
    await expect(paywall).toBeVisible({ timeout: 5_000 });
    await expect(paywall).toContainText(
      "Connect private repositories with Skill Studio Pro",
    );
    await expect(paywall).toContainText("Pro adds private repo connections");
    await expect(page.getByTestId("paywall-upgrade")).toBeVisible();
    await expect(page.getByTestId("paywall-maybe-later")).toBeVisible();

    // The pre-0833 "50-skill free tier" copy must be GONE.
    await expect(paywall).not.toContainText("50-skill free tier");

    // Click "Upgrade to Pro" — must invoke openExternalUrl with the
    // canonical pricing URL.
    await page.getByTestId("paywall-upgrade").click();
    const opened = await getBridgeStateField<string>(page, "lastOpenedUrl");
    expect(opened).toBe(PRICING_URL);
  });

  test("AC-US2-03: 'Maybe later' closes the paywall without opening pricing", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        __BRIDGE_STATE__?: {
          signedIn: boolean;
          tier: string;
          skillCount: number;
          skillLimit: number | null;
        };
      };
      if (w.__BRIDGE_STATE__) {
        w.__BRIDGE_STATE__.signedIn = true;
        w.__BRIDGE_STATE__.tier = "free";
        w.__BRIDGE_STATE__.skillCount = 7;
        w.__BRIDGE_STATE__.skillLimit = null;
      }
    });

    await page.goto("/index.html");
    await expect(
      page.getByRole("button", { name: /new skill/i }),
    ).toBeVisible({ timeout: 10_000 });
    await dispatchPrivateRepoConnect(page);

    const paywall = page.getByTestId("paywall-modal");
    await expect(paywall).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("paywall-maybe-later").click();
    await expect(paywall).toBeHidden();
    const opened = await getBridgeStateField<string>(page, "lastOpenedUrl");
    expect(opened).toBeNull();
  });

  test("paywall ESC key closes the modal", async ({ page }) => {
    await installBridgeShim(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        __BRIDGE_STATE__?: {
          signedIn: boolean;
          tier: string;
          skillCount: number;
          skillLimit: number | null;
        };
      };
      if (w.__BRIDGE_STATE__) {
        w.__BRIDGE_STATE__.signedIn = true;
        w.__BRIDGE_STATE__.tier = "free";
        w.__BRIDGE_STATE__.skillCount = 7;
        w.__BRIDGE_STATE__.skillLimit = null;
      }
    });

    await page.goto("/index.html");
    await expect(
      page.getByRole("button", { name: /new skill/i }),
    ).toBeVisible({ timeout: 10_000 });
    await dispatchPrivateRepoConnect(page);

    const paywall = page.getByTestId("paywall-modal");
    await expect(paywall).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(paywall).toBeHidden();
  });

  test("AC-US2-06: Pro user clicking 'New Skill' never sees the paywall (no 51st-create gate)", async ({
    page,
  }) => {
    // 0833 pivot: skill-create is no longer tier-gated for ANY tier. The
    // test asserts this by clicking the canonical create entry (which
    // pre-0833 fired the paywall on the 51st skill) and verifying the
    // paywall stays hidden — even with a count well above the old cap.
    await installBridgeShim(page);
    await page.addInitScript(() => {
      const w = window as unknown as {
        __BRIDGE_STATE__?: {
          signedIn: boolean;
          tier: string;
          skillCount: number;
          skillLimit: number | null;
        };
      };
      if (w.__BRIDGE_STATE__) {
        w.__BRIDGE_STATE__.signedIn = true;
        w.__BRIDGE_STATE__.tier = "pro";
        w.__BRIDGE_STATE__.skillCount = 200;
        w.__BRIDGE_STATE__.skillLimit = null;
      }
    });

    await page.goto("/index.html");
    await page.getByRole("button", { name: /new skill/i }).click();
    const paywall = page.getByTestId("paywall-modal");
    await expect(paywall).toBeHidden({ timeout: 2_000 });
  });
});
