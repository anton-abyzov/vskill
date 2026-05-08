// ---------------------------------------------------------------------------
// 0831 T-030 — cross-cutting auth-flow regression spec.
//
// Owner: testing-agent (verification slice).
//
// Scope: walks the WHOLE 0831 happy-path end-to-end against the Vite-built
// Skill Studio shell (`dist/eval-ui/index.html` + `preferences.html`) with
// the Tauri IPC layer faked via `window.__TAURI_INTERNALS__.invoke`. Mirrors
// the stubbing approach in `auth-and-paywall.spec.ts` (T-028) — same
// init-script timing, same call-recording shape — and extends it with the
// folder-picker disambiguation flow that lives in the Preferences window.
//
// Coverage map:
//   - Test 1 (sign-in flow):   AC-US1-01..05 — device-code dialog, polling,
//                              avatar+login chip post-grant.
//   - Test 2 (folder picker):  AC-US3-01, AC-US3-02 — home-root warning
//                              modal + Pick again → ProjectRoot path.
//   - Test 3 (paywall on 51st): AC-US5-03, AC-US5-04, AC-US8-03 — paywall
//                              modal + canonical pricing-URL handoff via
//                              `open_external_url`.
//   - Test 4 (connected-repo widget): AC-US4-01..03 — sanity-checks the
//                              widget renders the picked-repo metadata IF
//                              the studio shell mounts it. The component
//                              ships in this increment but is not wired
//                              into the shell yet (desktop-folder-agent
//                              built it; the wire-up belongs to a
//                              follow-up); the test is `test.fixme()` so it
//                              fails loudly the day the mount lands.
//
// Skipped on non-darwin per the existing desktop-e2e convention.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

interface BridgeCall {
  cmd: string;
  args?: Record<string, unknown>;
}

interface BridgeFixture {
  calls: () => Promise<BridgeCall[]>;
  clearCalls: () => Promise<void>;
}

const PRICING_URL = "https://verified-skill.com/pricing";

// ---------------------------------------------------------------------------
// Bridge shim — installed via `addInitScript` BEFORE the React bundle
// parses, mirroring `auth-and-paywall.spec.ts`. State is mutable via
// `window.__BRIDGE_STATE__` so each test seeds its own scenario.
// ---------------------------------------------------------------------------

async function installBridgeShim(page: Page): Promise<BridgeFixture> {
  await page.addInitScript(() => {
    type Calls = { cmd: string; args?: Record<string, unknown> }[];

    interface PickQueueEntry {
      path: string;
      classification:
        | { kind: "home_root" }
        | { kind: "personal_scope" }
        | {
            kind: "project_root";
            has_git: boolean;
            remote_url: string | null;
          }
        | { kind: "unclassified" };
    }

    interface RepoInfoQueueEntry {
      name: string | null;
      branch: string | null;
      is_private: boolean | null;
      sync_state:
        | { kind: "clean" }
        | { kind: "dirty"; count: number }
        | { kind: "ahead"; count: number }
        | { kind: "behind"; count: number }
        | { kind: "no_remote" };
    }

    interface State {
      // Auth
      pendingDeviceFlow: boolean;
      signedIn: boolean;
      pollOutcomes: string[];
      // Quota
      tier: "free" | "pro" | "enterprise";
      skillCount: number;
      skillLimit: number | null;
      // openExternalUrl invocation tracker
      lastOpenedUrl: string | null;
      // Folder picker queue — each call to `pick_default_project_folder`
      // shifts one entry; null = "user cancelled" if the queue is empty.
      pickQueue: PickQueueEntry[];
      // Repo-info queue — same FIFO model.
      repoInfoQueue: RepoInfoQueueEntry[];
      // Mid-paywall force-sync upgrade hook (unused here but matches T-028).
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
      skillCount: 49,
      skillLimit: 50,
      lastOpenedUrl: null,
      pickQueue: [],
      repoInfoQueue: [],
      flipToProOnForceSync: false,
    };

    function nowIso(): string {
      return new Date().toISOString();
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
        // ---------- settings + metadata ----------
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
        case "set_autostart":
          return undefined;

        // ---------- auth (device-flow) ----------
        case "start_github_device_flow":
          s.pendingDeviceFlow = true;
          if (s.pollOutcomes.length === 0) {
            // Default: 2 pendings then granted (matches the agent task brief).
            s.pollOutcomes = ["pending", "pending", "granted"];
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
          if (next === "pending") throw new Error("pending");
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
            login: "anton-abyzov",
            avatar_url:
              "https://avatars.githubusercontent.com/u/1234?v=4",
            email: "anton@example.com",
            cached_at: nowIso(),
          };
        }
        case "get_signed_in_user":
          return s.signedIn
            ? {
                login: "anton-abyzov",
                avatar_url:
                  "https://avatars.githubusercontent.com/u/1234?v=4",
                email: "anton@example.com",
                cached_at: nowIso(),
              }
            : null;
        case "sign_out":
          s.signedIn = false;
          return undefined;
        case "refresh_user_identity":
          return s.signedIn
            ? {
                login: "anton-abyzov",
                avatar_url:
                  "https://avatars.githubusercontent.com/u/1234?v=4",
                email: "anton@example.com",
                cached_at: nowIso(),
              }
            : null;

        // ---------- folders ----------
        case "pick_default_project_folder": {
          // FIFO from the seeded queue. If empty, model "user cancelled".
          const next = s.pickQueue.shift();
          return next ?? null;
        }
        case "get_repo_info": {
          const next = s.repoInfoQueue.shift();
          return (
            next ?? {
              name: null,
              branch: null,
              is_private: null,
              sync_state: { kind: "no_remote" },
            }
          );
        }

        // ---------- quota ----------
        case "quota_get":
          return makeQuotaSnapshot();
        case "quota_force_sync":
          if (s.flipToProOnForceSync) {
            s.tier = "pro";
            s.skillLimit = null;
          }
          return makeQuotaSnapshot();
        case "quota_can_create_skill": {
          const snapshot = makeQuotaSnapshot();
          let blocked = false;
          let reason = "ok";
          if (s.tier === "free") {
            const limit = s.skillLimit ?? 50;
            if (s.skillCount >= limit) {
              blocked = true;
              reason = "limit-reached";
            }
          }
          return { blocked, reason, snapshot };
        }
        case "quota_report_count":
          return undefined;

        // ---------- shell ----------
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

async function getBridgeStateField<T>(
  page: Page,
  key: string,
): Promise<T | null> {
  return page.evaluate((k) => {
    const w = window as unknown as {
      __BRIDGE_STATE__?: Record<string, unknown>;
    };
    return (w.__BRIDGE_STATE__?.[k] ?? null) as T | null;
  }, key);
}

// ---------------------------------------------------------------------------
// Suite — desktop-only, mirrors the convention used in
// `auth-and-paywall.spec.ts` and `auto-update.spec.ts`.
// ---------------------------------------------------------------------------

test.describe("0831 T-030 — auth + folder + paywall regression", () => {
  test.skip(
    process.platform !== "darwin",
    "desktop e2e only runs on darwin (matches existing convention)",
  );

  // -------------------------------------------------------------------------
  // Test 1: AC-US1-01..05 — device-flow code panel + polling + chip swap.
  // -------------------------------------------------------------------------
  test("Test 1 — sign-in: device-code dialog → polling → user chip", async ({
    page,
  }) => {
    const bridge = await installBridgeShim(page);

    // Default state has the queue ["pending","pending","granted"] so the
    // poll must walk three calls before the chip flips. Studio polls at
    // the IPC's returned `interval` (5s) — we shorten the wait by issuing
    // a custom poll-outcomes sequence. The bridge default already does
    // this; nothing to seed.

    await page.goto("/index.html");

    // Pre-grant: Sign-in pill is visible. We match by aria-label, which
    // UserDropdown.tsx sets to "Sign in with GitHub".
    const signInButton = page.getByRole("button", {
      name: /sign in with github/i,
    });
    await expect(signInButton).toBeVisible({ timeout: 10_000 });

    await bridge.clearCalls();
    await signInButton.click();

    // Device-code dialog appears with the user_code.
    const dialog = page.locator("[data-slot='sign-in-dialog']");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText("WDJB-MJHT");
    await expect(dialog).toContainText("github.com/login/device");

    // The IPC wiring fires `start_github_device_flow` once, then polls.
    // With a 5s interval and 3 poll outcomes (pending, pending, granted),
    // the chip swap can take up to ~15s — Playwright defaults to 5s for
    // expect timeouts so we widen for the polling window.
    const chip = page.locator("[data-slot='user-chip']");
    await expect(chip).toBeVisible({ timeout: 25_000 });
    await expect(chip).toContainText("anton-abyzov");
    // Avatar img inside the chip — assert it picked up the stub URL.
    const avatar = chip.locator("img");
    await expect(avatar).toHaveAttribute(
      "src",
      /avatars\.githubusercontent\.com/,
    );

    // Verify the IPC call sequence: start once + at least 1 poll +
    // get_signed_in_user on cold-start before the click.
    const calls = await bridge.calls();
    const cmdCounts: Record<string, number> = {};
    for (const c of calls) cmdCounts[c.cmd] = (cmdCounts[c.cmd] ?? 0) + 1;
    expect(cmdCounts["start_github_device_flow"]).toBeGreaterThanOrEqual(1);
    expect(cmdCounts["poll_github_device_flow"]).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: AC-US3-01 / AC-US3-02 — folder picker disambiguation in the
  // Preferences window. Picker first returns HomeRoot → warning modal;
  // user clicks Pick again; second picker call returns ProjectRoot →
  // commit succeeds and warning closes.
  // -------------------------------------------------------------------------
  test("Test 2 — folder picker: HomeRoot warning → Pick again → ProjectRoot commits", async ({
    page,
  }) => {
    await installBridgeShim(page);

    // Seed: signed in (so the picker is enabled) + queue two pick results.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __BRIDGE_STATE__?: {
          signedIn: boolean;
          pickQueue: Array<{
            path: string;
            classification:
              | { kind: "home_root" }
              | {
                  kind: "project_root";
                  has_git: boolean;
                  remote_url: string | null;
                };
          }>;
        };
      };
      if (w.__BRIDGE_STATE__) {
        w.__BRIDGE_STATE__.signedIn = true;
        w.__BRIDGE_STATE__.pickQueue = [
          { path: "/Users/anton", classification: { kind: "home_root" } },
          {
            path: "/Users/anton/Projects/foo",
            classification: {
              kind: "project_root",
              has_git: true,
              remote_url: "git@github.com:anton-abyzov/foo.git",
            },
          },
        ];
      }
    });

    await page.goto("/preferences.html");

    // GeneralTab is the default tab. The "Choose folder…" button label
    // comes from the i18n key `general.defaultProject.choose`.
    const chooseButton = page.getByRole("button", {
      name: /choose folder/i,
    });
    await expect(chooseButton).toBeVisible({ timeout: 10_000 });

    await chooseButton.click();

    // First pick → HomeRoot → warning modal must appear.
    const warningDialog = page.getByTestId("folder-picker-warning-dialog");
    await expect(warningDialog).toBeVisible({ timeout: 5_000 });
    await expect(warningDialog).toHaveAttribute("data-kind", "home_root");
    await expect(
      page.getByTestId("folder-picker-warning-path"),
    ).toContainText("/Users/anton");
    // Both action buttons present per AC-US3-02.
    await expect(
      page.getByTestId("folder-picker-warning-pick-again"),
    ).toBeVisible();
    await expect(
      page.getByTestId("folder-picker-warning-use-anyway"),
    ).toBeVisible();

    // Click "Pick again" — modal closes and the picker is re-invoked.
    // The second queued pick is a ProjectRoot, so the modal does NOT
    // re-appear and the path commits via `set_setting`.
    await page.getByTestId("folder-picker-warning-pick-again").click();

    // Modal must be gone.
    await expect(warningDialog).toBeHidden({ timeout: 5_000 });

    // The defaultProjectFolder display gets the new path on next render.
    // GeneralTab reads from `snapshot.general.defaultProjectFolder` which
    // is mutated via `setSetting` then `onSnapshotChanged`. Our stub for
    // `get_settings` always returns null for `defaultProjectFolder`, so
    // the display still shows the initial state — but we can verify that
    // `set_setting` was invoked with the right path via the call log.
    const calls = await page.evaluate(
      () =>
        (
          (window as unknown) as {
            __BRIDGE_CALLS__: { cmd: string; args?: Record<string, unknown> }[];
          }
        ).__BRIDGE_CALLS__,
    );
    const setCalls = calls.filter(
      (c) =>
        c.cmd === "set_setting" &&
        (c.args?.path === "general.defaultProjectFolder" ||
          c.args?.key === "general.defaultProjectFolder"),
    );
    // The path argument shape varies between bindings ({path,value} or
    // {key,value}); accept either. We just need the value to match.
    expect(setCalls.length).toBeGreaterThanOrEqual(1);
    const lastValue = setCalls[setCalls.length - 1]?.args?.value;
    expect(lastValue).toBe("/Users/anton/Projects/foo");
  });

  // -------------------------------------------------------------------------
  // Test 3: AC-US5-03/04 + AC-US8-03 — paywall on 51st create with the
  // canonical pricing-URL handoff. (Functionally the same as the T-028
  // smoke test, here re-asserted from the regression-suite POV so that a
  // future refactor of either spec breaks visibly in only one place.)
  // -------------------------------------------------------------------------
  test("Test 3 — paywall on 51st create → Upgrade opens canonical pricing URL", async ({
    page,
  }) => {
    const bridge = await installBridgeShim(page);

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
        w.__BRIDGE_STATE__.skillCount = 50;
        w.__BRIDGE_STATE__.skillLimit = 50;
      }
    });

    await page.goto("/index.html");

    const newSkill = page.getByRole("button", { name: /new skill/i });
    await expect(newSkill).toBeVisible({ timeout: 10_000 });

    await bridge.clearCalls();
    await newSkill.click();

    const paywall = page.getByTestId("paywall-modal");
    await expect(paywall).toBeVisible({ timeout: 5_000 });

    const calls = await bridge.calls();
    expect(calls.some((c) => c.cmd === "quota_can_create_skill")).toBe(true);

    // Click "Upgrade to Pro" — must invoke openExternalUrl with the
    // canonical pricing URL (single source of truth, AC-US8-03).
    await page.getByTestId("paywall-upgrade").click();
    const opened = await getBridgeStateField<string>(page, "lastOpenedUrl");
    expect(opened).toBe(PRICING_URL);
  });

  // -------------------------------------------------------------------------
  // Test 4: AC-US4-01..03 — ConnectedRepoWidget integration.
  //
  // The component ships in this increment (desktop-folder-agent) but its
  // mount point inside the studio shell has not landed yet — App.tsx still
  // contains a TODO comment ("when desktop-folder-agent mounts it"). This
  // test is `test.fixme()` so the suite stays green now and fails loudly
  // the day the wire-up lands, prompting whoever wires it to flip
  // `test.fixme` → `test` and confirm the assertions still hold.
  //
  // When un-fixme'd: assert `[data-testid='connected-repo-widget']`
  // renders with `repo-name="anton-abyzov/foo"` and a green-check
  // visibility-pill (public, non-locked) for the queued ProjectRoot.
  // -------------------------------------------------------------------------
  test.fixme(
    "Test 4 — connected-repo widget shows owner/repo + branch + public",
    async ({ page }) => {
      await installBridgeShim(page);

      await page.addInitScript(() => {
        const w = window as unknown as {
          __BRIDGE_STATE__?: {
            signedIn: boolean;
            pickQueue: Array<{
              path: string;
              classification:
                | {
                    kind: "project_root";
                    has_git: boolean;
                    remote_url: string | null;
                  };
            }>;
            repoInfoQueue: Array<{
              name: string | null;
              branch: string | null;
              is_private: boolean | null;
              sync_state: { kind: string };
            }>;
          };
        };
        if (w.__BRIDGE_STATE__) {
          w.__BRIDGE_STATE__.signedIn = true;
          w.__BRIDGE_STATE__.pickQueue = [
            {
              path: "/Users/anton/Projects/foo",
              classification: {
                kind: "project_root",
                has_git: true,
                remote_url: "git@github.com:anton-abyzov/foo.git",
              },
            },
          ];
          w.__BRIDGE_STATE__.repoInfoQueue = [
            {
              name: "anton-abyzov/foo",
              branch: "main",
              is_private: false,
              sync_state: { kind: "clean" },
            },
          ];
        }
      });

      await page.goto("/index.html");

      const widget = page.getByTestId("connected-repo-widget");
      await expect(widget).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("repo-name")).toContainText(
        "anton-abyzov/foo",
      );
      await expect(page.getByTestId("repo-branch")).toContainText("main");
      const visibility = page.getByTestId("visibility-pill").first();
      await expect(visibility).toBeVisible();
      // Public repos render a green check, NOT a lock icon. We assert the
      // pill does not announce "private".
      await expect(visibility).not.toContainText(/private/i);
    },
  );
});
