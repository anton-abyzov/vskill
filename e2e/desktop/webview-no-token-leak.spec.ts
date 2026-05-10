// ---------------------------------------------------------------------------
// 0836 US-003 / AC-US3-05 — WebView never holds a `gho_*` token.
//
// The deleted `account_get_token` IPC used to ship the raw GitHub OAuth
// token to the WebView so AccountContext could mint Authorization headers.
// 0836 US-003 keeps the bearer Rust-side; the eval-server's platform-proxy
// injects it on `/api/v1/account/*` calls.
//
// This spec is the safety net: with the desktop bundle signed in, scan the
// WebView document AND every `window`-attached object for any `gho_<...>`
// substring after each tab navigation. Zero matches is the success state.
//
// We also scan the document AFTER simulated tab navigations because some
// frameworks attach captured tokens to React state that survives a tab
// remount; the previous bug shape was "first sign-in OK, switch tabs,
// state leaks via cached headers".
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

const FAKE_TOKEN = "gho_test_token_DO_NOT_LEAK_INTO_DOM_AbCdEf123456789";

interface BridgeCall {
  cmd: string;
  args?: Record<string, unknown>;
}

async function installBridgeShim(page: Page, fakeToken: string): Promise<void> {
  await page.addInitScript((injectedToken) => {
    interface State {
      signedIn: boolean;
      // The fake bearer is held ONLY inside this shim — not exposed to the
      // WebView via any IPC. The whole point of the test is that no path
      // should leak it into the document. We intentionally serve up the
      // value when an IPC asks for it (the deleted account_get_token —
      // which the bridge MUST NOT call); if the impl regresses and re-adds
      // that call, the value will land in the DOM and the assertion below
      // will fire.
      bearerToken: string;
    }

    const w = window as unknown as Window & {
      __BRIDGE_CALLS__?: BridgeCall[];
      __BRIDGE_STATE__?: State;
      __TAURI_INTERNALS__?: {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    w.__BRIDGE_CALLS__ = [];
    w.__BRIDGE_STATE__ = {
      signedIn: true,
      bearerToken: injectedToken,
    };

    type BridgeCall = { cmd: string; args?: Record<string, unknown> };

    const profile = {
      userId: "user_e2e_octocat",
      displayName: "Octo Cat",
      githubHandle: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      bio: null,
      publicProfile: true,
      tier: "pro" as const,
      createdAt: "2026-01-15T10:00:00.000Z",
    };

    const invoke = async (
      cmd: string,
      args?: Record<string, unknown>,
    ): Promise<unknown> => {
      const s = w.__BRIDGE_STATE__!;
      w.__BRIDGE_CALLS__!.push({ cmd, args });
      switch (cmd) {
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
              lastKnownVersion: "1.0.18",
              skippedVersion: null,
              snoozedUntil: null,
            },
            privacy: {
              telemetryEnabled: false,
              crashReportingEnabled: false,
            },
            advanced: { logLevel: "info" },
            studio: { lifecycleDefault: "ask" },
          };
        case "get_app_metadata":
          return {
            version: "1.0.18",
            build: "debug",
            commit: "test",
            target: "aarch64-apple-darwin",
            arch: "aarch64",
          };
        case "check_for_updates":
          return { available: false, currentVersion: "1.0.18" };
        case "get_signed_in_user":
          return s.signedIn
            ? {
                login: profile.githubHandle,
                avatar_url: profile.avatarUrl,
                email: null,
                cached_at: new Date().toISOString(),
              }
            : null;
        case "account_get_platform_url":
          return "https://verified-skill.com";
        case "account_get_user_summary":
          return {
            signedIn: s.signedIn,
            login: s.signedIn ? profile.githubHandle : null,
            avatarUrl: s.signedIn ? profile.avatarUrl : null,
            tier: profile.tier,
          };
        // 0836 US-002: studio token IPC. We return a non-leaky dummy so the
        // fetch wrapper has something to inject; this value is NOT a
        // GitHub token.
        case "get_studio_token":
          return "studio-token-e2e-not-a-real-secret";
        // 0836 US-003 ENFORCEMENT: if the bundle ever regresses to
        // calling the deleted IPC, return the fake bearer so the DOM
        // assertion below catches it. The expected behaviour is that
        // the WebView NEVER calls this case.
        case "account_get_token":
          return s.bearerToken;
        case "quota_get":
        case "quota_force_sync":
          return {
            cache: {
              response: {
                tier: profile.tier,
                skillCount: 0,
                skillLimit: null,
                lastSyncedAt: new Date().toISOString(),
                gracePeriodDaysRemaining: 7,
                serverNow: new Date().toISOString(),
              },
              localAtSync: new Date().toISOString(),
              clockSkewMs: 0,
            },
            localSkillCount: 0,
            isFresh: true,
            daysRemaining: 7,
          };
        case "quota_can_create_skill":
          return { blocked: false, reason: "ok", snapshot: null };
        default:
          return undefined;
      }
    };
    w.__TAURI_INTERNALS__ = { invoke };
  }, fakeToken);
}

async function getBridgeCalls(page: Page): Promise<BridgeCall[]> {
  return page.evaluate(
    () =>
      ((window as unknown) as { __BRIDGE_CALLS__: BridgeCall[] })
        .__BRIDGE_CALLS__ ?? [],
  );
}

async function assertNoTokenInDom(page: Page, token: string): Promise<void> {
  const ghoPattern = /gho_[A-Za-z0-9_-]+/;
  // 1. Outer HTML.
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  expect(html.match(ghoPattern), "gho_* must not appear in DOM HTML").toBeNull();
  expect(html.includes(token), "fake-token must not appear in DOM").toBe(false);

  // 2. Top-level window properties (excluding our own injected shim state).
  const windowDump = await page.evaluate(() => {
    const seen = new Set<unknown>();
    const out: string[] = [];
    const walk = (val: unknown, depth: number): void => {
      if (depth > 3) return;
      if (typeof val !== "object" || val == null) {
        if (typeof val === "string") out.push(val);
        return;
      }
      if (seen.has(val)) return;
      seen.add(val);
      for (const k of Object.keys(val as Record<string, unknown>)) {
        // Skip our own shim state — that's the test fixture, not the bug.
        if (k === "__BRIDGE_STATE__") continue;
        if (k === "__BRIDGE_CALLS__") continue;
        if (k === "__TAURI_INTERNALS__") continue;
        try {
          walk((val as Record<string, unknown>)[k], depth + 1);
        } catch {
          /* skip getters that throw */
        }
      }
    };
    walk(window, 0);
    return out.join("\n");
  });
  expect(
    windowDump.match(ghoPattern),
    "gho_* must not appear on any window-attached value",
  ).toBeNull();
  expect(
    windowDump.includes(token),
    "fake bearer token must not appear on any window-attached value",
  ).toBe(false);
}

test.describe("0836 US-003 — WebView never holds a `gho_*` token", () => {
  test("AC-US3-05: signed-in DOM contains no `gho_*` substring", async ({
    page,
  }) => {
    await installBridgeShim(page, FAKE_TOKEN);
    await page.goto("/index.html");

    // Wait for at least the initial bundle render — the desktop sidebar is
    // a stable signal across all builds since 0828.
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible({
      timeout: 10_000,
    });

    await assertNoTokenInDom(page, FAKE_TOKEN);

    // Sanity: the WebView MUST NOT have called the deleted IPC. If a
    // future regression re-adds the call, this catches it before the DOM
    // scan even runs.
    const calls = await getBridgeCalls(page);
    const cmds = calls.map((c) => c.cmd);
    expect(cmds, "deleted IPC must never be invoked").not.toContain(
      "account_get_token",
    );
  });

  test("AC-US3-05: DOM stays clean after navigating between tabs", async ({
    page,
  }) => {
    await installBridgeShim(page, FAKE_TOKEN);
    await page.goto("/index.html");
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible({
      timeout: 10_000,
    });

    // Click through the available account tabs (when the account sidebar
    // entry is mounted). Some bundles don't surface the entry until the
    // user is signed in via real flow — guard with `count() > 0`.
    const accountEntry = page.getByTestId("account-sidebar-entry");
    if ((await accountEntry.count()) > 0) {
      await accountEntry.click();
      await assertNoTokenInDom(page, FAKE_TOKEN);

      const tabs = ["profile", "billing", "repos", "skills", "tokens"];
      for (const t of tabs) {
        const tab = page.getByTestId(`account-tab-${t}`);
        if ((await tab.count()) === 0) continue;
        await tab.click();
        await assertNoTokenInDom(page, FAKE_TOKEN);
      }
    }
  });
});
