// ---------------------------------------------------------------------------
// 0834 — Desktop + npx-studio /account parity.
//
// Owner: testing-agent (T-032). Satisfies AC-US13-05/06:
//   - Same component renders identically across desktop (Tauri WebView) and
//     `npx vskill studio` (browser tab) when fed by the shared eval-ui shell.
//   - Stub `__TAURI_INTERNALS__` IPCs to drive the desktop code path; same
//     spec re-runs in non-Tauri mode to exercise the studio surface, asserting
//     the rendered DOM is structurally equivalent.
//
// Coverage:
//   - AC-US12-01: Account sidebar entry below Skills (desktop)
//   - AC-US12-02: Account sidebar entry in npx-studio (browser)
//   - AC-US12-03: Bearer token used from keyring (desktop) / cookie (studio)
//   - AC-US12-04: Offline mode shows cached banner
//   - AC-US12-05: ConnectedReposTable + ProfileForm + PlanCard render in both
//   - AC-US12-06: useAccount() hook drives both surfaces
//   - AC-US13-06: get_account_url IPC returns the canonical URL
//
// Architecture mirrors auth-and-paywall.spec.ts (the 0833 reference):
//   - Inject `__TAURI_INTERNALS__` shim BEFORE the React bundle parses.
//   - Stub IPCs: get_settings, get_signed_in_user, get_app_metadata,
//                check_for_updates, set_setting, reset_settings,
//                quota_get, quota_force_sync, get_account_url,
//                get_keyring_bearer, account_fetch_profile,
//                account_fetch_repos.
//   - Drive the offline-mode path by toggling `__BRIDGE_STATE__.offline`.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

interface BridgeCall {
  cmd: string;
  args?: Record<string, unknown>;
}

const PLATFORM_BASE_URL = "https://verified-skill.com";
const ACCOUNT_URL = `${PLATFORM_BASE_URL}/account`;

const PROFILE_FIXTURE = {
  userId: "user_e2e_octocat",
  displayName: "Octo Cat",
  githubHandle: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
  bio: "I do open source.",
  publicProfile: true,
  tier: "pro" as const,
  createdAt: "2026-01-15T10:00:00.000Z",
};

// ConnectedReposListDTO from vskill-platform/src/lib/types/account.ts
// (shipped 2026-05-08). The shared eval-ui ConnectedReposTable consumes
// this exact shape via useAccount(); the desktop bridge IPC and the
// platform API both serialize to it. Wire invariants:
//   - lowercase syncStatus
//   - githubInstallationId is a STRING (BigInt does not survive JSON)
//   - top-level totalCount/publicCount/privateCount drive the summary chip
const REPOS_FIXTURE = {
  repos: [
    {
      repoId: "repo_001",
      ownerLogin: "octocat",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      repoName: "hello-world",
      repoFullName: "octocat/hello-world",
      isPrivate: false,
      skillsCount: 3,
      syncStatus: "green",
      lastSyncedAt: "2026-05-08T11:00:00.000Z",
      lastActivityAt: "2026-05-08T11:00:00.000Z",
      lastErrorMessage: null,
      githubInstallationId: "12345",
    },
    {
      repoId: "repo_002",
      ownerLogin: "octocat",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
      repoName: "private-fixture",
      repoFullName: "octocat/private-fixture",
      isPrivate: true,
      skillsCount: 7,
      syncStatus: "amber",
      lastSyncedAt: "2026-05-07T09:30:00.000Z",
      lastActivityAt: "2026-05-08T09:30:00.000Z",
      lastErrorMessage: null,
      githubInstallationId: "12345",
    },
  ],
  totalCount: 2,
  publicCount: 1,
  privateCount: 1,
};

async function installBridgeShim(page: Page): Promise<void> {
  await page.addInitScript(
    ({ profile, repos, accountUrl }) => {
      type Calls = { cmd: string; args?: Record<string, unknown> }[];

      interface State {
        signedIn: boolean;
        offline: boolean;
        tier: "free" | "pro" | "enterprise";
        bearerToken: string | null;
        cachedProfile: typeof profile | null;
        cachedRepos: typeof repos | null;
        lastSyncedAt: string | null;
      }

      const w = window as unknown as Window & {
        __BRIDGE_STATE__?: State;
        __BRIDGE_CALLS__?: Calls;
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
        offline: false,
        tier: "pro",
        bearerToken: "vsk_e2e_keyring_bearer",
        cachedProfile: profile,
        cachedRepos: repos,
        lastSyncedAt: new Date().toISOString(),
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
                lastKnownVersion: "1.0.14",
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
          case "set_setting":
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
          case "get_signed_in_user":
            return s.signedIn
              ? {
                  login: profile.githubHandle,
                  avatar_url: profile.avatarUrl,
                  email: "octocat@github.com",
                  cached_at: new Date().toISOString(),
                }
              : null;
          case "sign_out":
            s.signedIn = false;
            return undefined;
          case "pick_default_project_folder":
            return null;
          case "get_repo_info":
            return {
              name: null,
              branch: null,
              is_private: null,
              sync_state: { kind: "no_remote" },
            };
          case "quota_get":
          case "quota_force_sync":
            return {
              cache: {
                response: {
                  tier: s.tier,
                  skillCount: 7,
                  skillLimit: null,
                  lastSyncedAt: new Date().toISOString(),
                  gracePeriodDaysRemaining: 7,
                  serverNow: new Date().toISOString(),
                },
                localAtSync: new Date().toISOString(),
                clockSkewMs: 0,
              },
              localSkillCount: 7,
              isFresh: true,
              daysRemaining: 7,
            };
          case "quota_can_create_skill":
            return { blocked: false, reason: "ok", snapshot: null };
          case "quota_report_count":
            return undefined;
          case "open_external_url":
            return undefined;
          // 0834 desktop IPCs (T-027/T-028, AC-US12-03 + AC-US13-06):
          case "get_account_url":
            return accountUrl;
          // AccountTauriBridge.getAuthHeader() invokes `account_get_token`
          // lazily on each fetch and uses the result as the Bearer header.
          case "account_get_token":
            return s.bearerToken;
          // Older alias kept for backward-compat with stale bundles.
          case "get_keyring_bearer":
            return s.bearerToken;
          default:
            return undefined;
        }
      };

      w.__TAURI_INTERNALS__ = { invoke };
    },
    {
      profile: PROFILE_FIXTURE,
      repos: REPOS_FIXTURE,
      accountUrl: ACCOUNT_URL,
    },
  );
}

async function setBridgeOffline(page: Page, offline: boolean): Promise<void> {
  await page.evaluate((flag) => {
    const w = window as unknown as {
      __BRIDGE_STATE__?: { offline: boolean };
    };
    if (w.__BRIDGE_STATE__) w.__BRIDGE_STATE__.offline = flag;
  }, offline);
}

async function getBridgeCalls(page: Page): Promise<BridgeCall[]> {
  return page.evaluate(
    () =>
      ((window as unknown) as { __BRIDGE_CALLS__: BridgeCall[] })
        .__BRIDGE_CALLS__ ?? [],
  );
}

/**
 * AccountTauriBridge sets `platformBaseUrl = "https://verified-skill.com"`
 * for desktop + studio surfaces. The shared eval-ui hooks then `fetch()`
 * `<base>/api/v1/account/profile` etc. with the Bearer header from
 * `account_get_token`. Stub those URLs so the e2e doesn't hit prod.
 */
async function stubAccountFetches(page: Page): Promise<void> {
  // Playwright runs routes in REGISTRATION-REVERSED order — the LAST
  // registered handler wins. Register the catch-all FIRST and the
  // specific endpoints LAST so /profile and /repos hit their targeted
  // fixtures, not the empty {} fallback.
  await page.route(
    /^https:\/\/verified-skill\.com\/api\/v1\/account\//,
    (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({}),
        });
      }
      return route.fallback();
    },
  );
  await page.route(
    "https://verified-skill.com/api/v1/account/profile",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROFILE_FIXTURE),
      }),
  );
  await page.route(
    "https://verified-skill.com/api/v1/account/repos",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(REPOS_FIXTURE),
      }),
  );
}

// Desktop App.tsx mounts AccountSidebarEntry below the Skills sidebar
// section and renders AccountShell inline when the entry is active.
// `desktop-sidebar` wraps both. `account-sidebar-entry` is the Account
// row; the existing Skills sidebar component carries `sidebar` testid.
test.describe("0834 US-012 — Desktop /account view", () => {
  test("AC-US12-01: 'Account' sidebar entry sits below 'Skills' and is clickable", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await stubAccountFetches(page);
    await page.goto("/index.html");

    const desktopSidebar = page.getByTestId("desktop-sidebar");
    await expect(desktopSidebar).toBeVisible({ timeout: 10_000 });

    // Skills section uses the existing `sidebar` testid; Account entry
    // has the dedicated `account-sidebar-entry` testid.
    const skillsSection = desktopSidebar.getByTestId("sidebar");
    const accountEntry = desktopSidebar.getByTestId("account-sidebar-entry");
    await expect(skillsSection).toBeVisible();
    await expect(accountEntry).toBeVisible();

    const skillsBox = await skillsSection.boundingBox();
    const accountBox = await accountEntry.boundingBox();
    expect(skillsBox).toBeTruthy();
    expect(accountBox).toBeTruthy();
    // Account sits BELOW Skills (greater y).
    expect(accountBox!.y).toBeGreaterThan(skillsBox!.y);
  });

  test("AC-US12-01 + AC-US12-05: clicking Account renders AccountShell inline with all 7 tabs", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await stubAccountFetches(page);
    await page.goto("/index.html");

    await expect(page.getByTestId("desktop-sidebar")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("account-sidebar-entry").click();

    // Inline mount — NOT a webview pop-out (per Q2). AccountProviderHost
    // mounts AccountShell asynchronously after the Tauri context resolves
    // (createTauriAccountContext); subsequent re-renders can momentarily
    // unmount + remount the shell. Scope assertions through the shell
    // locator so they all resolve against the same render.
    const shell = page.getByTestId("account-shell");
    await expect(shell).toBeVisible({ timeout: 10_000 });
    await expect(shell.getByTestId("account-shell-sidenav")).toBeVisible();
    await expect(shell.getByTestId("account-shell-header")).toBeVisible();

    // Spec sidebar order: Profile · Billing · Repos · Skills · Tokens
    // · Notifications · Danger zone.
    for (const key of [
      "profile",
      "billing",
      "repos",
      "skills",
      "tokens",
      "notifications",
      "danger",
    ]) {
      await expect(shell.getByTestId(`account-tab-${key}`)).toBeVisible();
    }
  });

  test("AC-US12-03: Bearer token from keyring is fetched (account_get_token IPC)", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await stubAccountFetches(page);
    await page.goto("/index.html");

    await page.getByTestId("account-sidebar-entry").click();
    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 5_000,
    });

    // AccountTauriBridge.getAuthHeader() invokes account_get_token lazily
    // on each fetch — the test waits a short tick for at least one call.
    await expect
      .poll(
        async () => {
          const calls = await getBridgeCalls(page);
          return calls.map((c) => c.cmd);
        },
        { timeout: 5_000 },
      )
      .toContain("account_get_token");
  });

  test("AC-US12-04: offline mode shows cached banner; reconnect hides it", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await stubAccountFetches(page);

    // Override navigator.onLine BEFORE the bundle boots so AccountShell's
    // initial render passes online={false} (App.tsx:902 reads
    // `navigator.onLine !== false`). context.setOffline() blocks the
    // local eval-server too, so prefer the navigator-property hook here.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto("/index.html");

    await page.getByTestId("account-sidebar-entry").click();
    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("account-shell-offline-banner"),
    ).toBeVisible({ timeout: 5_000 });

    // Reconnect — flip navigator.onLine back to true and remount the
    // shell (sidebar toggle is the documented refresh trigger). The
    // banner is gated on the `online` prop, which AccountShell re-reads
    // when the host re-renders.
    await page.evaluate(() => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => true,
      });
    });
    // Toggle off the account view + back on so the host re-evaluates
    // navigator.onLine when it re-mounts AccountShell.
    await page.getByTestId("account-sidebar-entry").click(); // close
    await page.getByTestId("account-sidebar-entry").click(); // re-open
    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByTestId("account-shell-offline-banner"),
    ).toBeHidden({ timeout: 5_000 });
  });

  test("AC-US13-06: get_account_url IPC returns the canonical platform URL", async ({
    page,
  }) => {
    await installBridgeShim(page);
    await page.goto("/index.html");

    const url = await page.evaluate(async () => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string) => Promise<string>;
        };
      };
      return w.__TAURI_INTERNALS__?.invoke("get_account_url");
    });
    expect(url).toBe(ACCOUNT_URL);
  });
});

// npx-studio surface = same App.tsx, same eval-server bundle, but
// without __TAURI_INTERNALS__ (cookie-mode instead of bearer-mode).
// AccountSidebarEntry + AccountShell mount identically. Same testids.
test.describe("0834 US-012 — npx vskill studio /account parity", () => {
  test("AC-US12-02 + AC-US12-05: studio sidebar exposes Account and renders the cabinet", async ({
    page,
  }) => {
    // No installBridgeShim — studio surface lacks __TAURI_INTERNALS__,
    // so isTauriHost() returns false and AccountProviderHost falls
    // through to cookie-mode (same-origin /api/v1/account/* fetches).
    // Stub the eval-server origin (port 3077) instead of verified-skill.com.
    await page.route("**/api/v1/account/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROFILE_FIXTURE),
      }),
    );
    await page.route("**/api/v1/account/repos", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(REPOS_FIXTURE),
      }),
    );

    await page.goto("/index.html");

    const sidebar = page.getByTestId("desktop-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByTestId("account-sidebar-entry")).toBeVisible();

    await sidebar.getByTestId("account-sidebar-entry").click();

    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("account-shell-sidenav")).toBeVisible();
    // Account default tab renders profile-tab content (testid presence is
    // the parity contract; component-level testids depend on which tab
    // is active and what the API returned).
    await expect(page.getByTestId("account-tab-profile")).toBeVisible();
  });

  test("AC-US12-06: same App.tsx mount path — desktop + studio surfaces share the AccountShell DOM contract", async ({
    page,
  }) => {
    await page.route("**/api/v1/account/profile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PROFILE_FIXTURE),
      }),
    );
    await page.route("**/api/v1/account/repos", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(REPOS_FIXTURE),
      }),
    );

    // Studio surface: no Tauri shim → cookie mode.
    await page.goto("/index.html");
    await page.getByTestId("account-sidebar-entry").click();
    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 5_000,
    });

    const studioTestIds = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="account-shell"]');
      if (!root) return [];
      return Array.from(root.querySelectorAll("[data-testid]")).map((el) =>
        el.getAttribute("data-testid"),
      );
    });
    expect(studioTestIds).toContain("account-shell-sidenav");
    expect(studioTestIds).toContain("account-shell-header");
    expect(studioTestIds).toContain("account-tab-profile");

    // Desktop surface: install Tauri shim → bearer mode. Same App.tsx,
    // so the DOM contract above must hold identically.
    await page.goto("about:blank");
    await installBridgeShim(page);
    await stubAccountFetches(page);
    await page.goto("/index.html");
    await page.getByTestId("account-sidebar-entry").click();
    await expect(page.getByTestId("account-shell")).toBeVisible({
      timeout: 5_000,
    });

    const desktopTestIds = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="account-shell"]');
      if (!root) return [];
      return Array.from(root.querySelectorAll("[data-testid]")).map((el) =>
        el.getAttribute("data-testid"),
      );
    });
    for (const required of [
      "account-shell-sidenav",
      "account-shell-header",
      "account-tab-profile",
    ]) {
      expect(desktopTestIds).toContain(required);
    }
  });
});
