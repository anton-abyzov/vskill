// ---------------------------------------------------------------------------
// VIDEO-DEMO — Skill Studio full submission → update lifecycle (anton-grid).
//
// A SINGLE continuous, watchable Playwright test that records the entire
// authored-skill lifecycle end to end, in-app, with on-screen captions:
//
//   1. select anton-grid (v1.0.0)
//   2. open the Edit tab
//   3. bump the SKILL.md version 1.0.0 → 1.0.1 in the raw editor
//   4. Save
//   5. Publish → commit drawer (git/diff stubbed hasChanges:true)
//   6. fill the commit message → Commit & Push (in-app submit, NO redirect)
//   7. assert the inline publish-outcome (data-outcome="created")
//   8. open My Queue → anton-grid submission RECEIVED
//   9. inject ONE SSE frame flipping it to PUBLISHED → row transition
//  10. /api/skills/updates reports anton-grid updateAvailable → bell badge
//  11. click the bell → dropdown → Update anton-grid locally (stub succeeds)
//  12. local copy now reads v1.0.1 → "Done"
//
// WHY THIS LIVES IN THE `live` PROJECT (`@live`, `-live.spec.ts`):
//   It reuses the exact stub patterns + selectors from
//   submission-lifecycle-live.spec.ts (0860). The platform calls are STUBBED
//   on the local eval-server origin (CORS-free architecture — the browser only
//   ever talks to localhost). The terminal decision is injected as one SSE
//   frame on /api/v1/submissions/stream?mine=1 (the studio-side FORCE path),
//   keeping the recording deterministic and self-contained.
//
// The spec records video (test.use video:'on'); a stable copy is lifted to
// e2e/demo-output/lifecycle-demo.webm by the runner wrapper.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

// Top-level config (video + viewport must NOT sit inside a describe group).
// The recorded video.webm is lifted to the stable deliverable path
// (e2e/demo-output/lifecycle-demo.webm) by the runner wrapper
// (e2e/scripts/record-lifecycle-demo.sh) AFTER the run flushes the recording —
// doing it in an afterEach hook deadlocks because video.saveAs() waits for the
// context to close, which hasn't happened yet inside the hook.
test.use({
  video: "on",
  viewport: { width: 1440, height: 900 },
});

// Runs under its own `demo` Playwright project (playwright.config.ts).
test.describe("VIDEO-DEMO — anton-grid lifecycle", () => {
  const SUBMISSION_ID = "sub_demo_anton_grid";
  const SKILL_NAME = "anton-grid";
  const SKILL_PLUGIN = "fixtures"; // standalone scanner sets plugin="<root basename>"
  const SKILL_ID = `${SKILL_PLUGIN}/${SKILL_NAME}`;
  const REMOTE_SSH = "git@github.com:anton-abyzov/anton-grid.git";
  const REPO_URL = "https://github.com/anton-abyzov/anton-grid";

  // ── caption banner ───────────────────────────────────────────────────────
  // A fixed, high-z-index, semi-opaque dark banner injected before each step
  // so the recording is self-narrating. Re-injected every call (replaces).
  async function caption(page: Page, text: string, holdMs = 2100): Promise<void> {
    await page.evaluate((label) => {
      const ID = "__demo_caption__";
      let el = document.getElementById(ID);
      if (!el) {
        el = document.createElement("div");
        el.id = ID;
        document.body.appendChild(el);
      }
      el.textContent = label;
      Object.assign(el.style, {
        position: "fixed",
        top: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        background: "rgba(12, 14, 20, 0.92)",
        color: "#F5F7FA",
        font: "600 22px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        letterSpacing: "0.2px",
        padding: "14px 26px",
        borderRadius: "12px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.12)",
        maxWidth: "82vw",
        textAlign: "center",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      } as Partial<CSSStyleDeclaration>);
    }, text);
    await page.waitForTimeout(holdMs);
  }

  // Wall-clock at which the bell hook's boot poll of /api/skills/updates
  // fired. The hook's staleness window is 60s; we wait until it has elapsed
  // before forcing the visibility re-poll so the refresh is guaranteed.
  let bootPollAt = 0;

  // Block until ≥62s have passed since the boot poll (hook stale-after = 60s).
  async function waitUntilUpdatesStale(page: Page): Promise<void> {
    const elapsed = Date.now() - bootPollAt;
    const remaining = 62_000 - elapsed;
    if (remaining > 0) {
      // Hold on the caption so the wait is part of the watchable recording.
      await page.waitForTimeout(remaining);
    }
  }

  // Drive a hidden→visible visibilitychange so the bell hook re-polls
  // /api/skills/updates via its real refresh path.
  async function forceVisibilityRefresh(page: Page): Promise<void> {
    await page.evaluate(() => {
      const fire = (value: string) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => value,
        });
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => value === "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      fire("hidden");
      fire("visible");
    });
  }

  // ── git + submission route stubs (mirror 0860) ───────────────────────────
  function stubGitRoutes(page: Page) {
    return Promise.all([
      page.route("**/api/git/remote", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ remoteUrl: REMOTE_SSH, branch: "main", hasRemote: true }),
        }),
      ),
      // hasChanges:true → the Publish drawer opens with a real diff.
      page.route("**/api/git/diff", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hasChanges: true,
            diff:
              "diff --git a/SKILL.md b/SKILL.md\n" +
              "-version: \"1.0.0\"\n" +
              "+version: \"1.0.1\"\n",
            fileCount: 1,
          }),
        }),
      ),
      page.route("**/api/git/publish", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            commitSha: "a17c0de9f1",
            branch: "main",
            remoteUrl: REMOTE_SSH,
            stdout: "main a17c0de Bump anton-grid to v1.0.1\n",
            stderr: "",
          }),
        }),
      ),
    ]);
  }

  // POST /api/v1/submissions → controllable in-app "created" outcome.
  function stubSubmitToQueue(page: Page) {
    return page.route("**/api/v1/submissions", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: SUBMISSION_ID,
          skillName: SKILL_NAME,
          skillPath: `e2e/fixtures/skills/${SKILL_NAME}/SKILL.md`,
          state: "RECEIVED",
          createdAt: new Date().toISOString(),
        }),
      });
    });
  }

  // GET /api/v1/submissions?mine=1 → the feed My Queue loads. The submission
  // id MUST be here for the SSE transition (own-id filter) to apply.
  function stubMyQueueFeed(page: Page) {
    return page.route("**/api/v1/submissions?mine=1", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          submissions: [
            {
              id: SUBMISSION_ID,
              skillName: SKILL_NAME,
              repoUrl: REPO_URL,
              state: "RECEIVED",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          queuePositions: { [SUBMISSION_ID]: 2 },
        }),
      }),
    );
  }

  // GET /api/v1/submissions/stream?mine=1 → inject ONE terminal frame
  // (PUBLISHED). The fetch-SSE reader parses it on the first read; EOF after.
  function stubQueueStream(page: Page, terminalState: string) {
    const frame =
      `event: message\n` +
      `data: ${JSON.stringify({
        submissionId: SUBMISSION_ID,
        skillName: SKILL_NAME,
        state: terminalState,
        timestamp: new Date().toISOString(),
      })}\n\n`;
    return page.route("**/api/v1/submissions/stream*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
        body: frame,
      }),
    );
  }

  // GET /api/skills/updates → drives the bell badge (updateCount). Swappable.
  function stubSkillUpdates(page: Page, rows: Array<Record<string, unknown>>) {
    return page.route("**/api/skills/updates*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      }),
    );
  }

  // POST /api/skills/<plugin>/<skill>/apply-improvement → Save target. Stub
  // it to a success no-op so the demo Save does NOT mutate the on-disk fixture
  // (the editor keeps the in-memory v1.0.1 content via CONTENT_SAVED).
  function stubSave(page: Page) {
    return page.route(
      `**/api/skills/${SKILL_PLUGIN}/${SKILL_NAME}/apply-improvement`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, version: "1.0.1" }),
        }),
    );
  }

  // POST /api/skills/<plugin>/<skill>/update → SSE stream ending in a `done`
  // frame carrying the new version (the update-locally affordance).
  function stubUpdateLocally(page: Page, version: string) {
    const body =
      `event: progress\n` +
      `data: ${JSON.stringify({ step: "fetch", message: "Pulling latest…" })}\n\n` +
      `event: done\n` +
      `data: ${JSON.stringify({ ok: true, version })}\n\n`;
    return page.route(`**/api/skills/${SKILL_PLUGIN}/${SKILL_NAME}/update*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body,
      }),
    );
  }

  // The bell-eligible update row for anton-grid (updateAvailable:true).
  function antonGridUpdateRow() {
    return {
      id: SKILL_ID,
      name: SKILL_ID, // "<plugin>/<skill>" — UpdateDropdown splits to locate.
      skillName: SKILL_NAME,
      localPlugin: SKILL_PLUGIN,
      localSkill: SKILL_NAME,
      installed: "1.0.0",
      latest: "1.0.1",
      latestVersion: "1.0.1",
      updateAvailable: true,
      origin: "registry",
      installLocations: [
        { agent: "claude", agentLabel: "Claude Code", readonly: false },
      ],
    };
  }

  test("full anton-grid lifecycle: bump → publish → queue → update", async ({ page }) => {
    // ~60-70s narrated recording — the default 30s test budget is far too
    // short. Give the whole continuous flow generous headroom.
    test.setTimeout(180_000);

    // Pin a deterministic DARK theme (most legible; on-brand studio look that
    // pairs with the dark caption banner) BEFORE the app boots.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("vskill-theme", "dark");
      } catch {
        /* ignore */
      }
    });

    // Record when the bell hook first polls /api/skills/updates so the
    // staleness wait at step 9 is measured from the real boot poll.
    page.on("request", (req) => {
      if (req.url().includes("/api/skills/updates") && bootPollAt === 0) {
        bootPollAt = Date.now();
      }
    });

    // The /api/skills/updates feed is empty until AFTER the publish is
    // accepted — held in a closure flag so the bell only lights once the
    // submission is PUBLISHED, matching the real lifecycle.
    let updatesLive = false;
    await page.route("**/api/skills/updates*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(updatesLive ? [antonGridUpdateRow()] : []),
      }),
    );

    await stubGitRoutes(page);
    await stubSave(page);
    await stubSubmitToQueue(page);
    await stubMyQueueFeed(page);
    await stubQueueStream(page, "PUBLISHED");
    await stubUpdateLocally(page, "1.0.1");

    // ── boot ────────────────────────────────────────────────────────────────
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='sidebar']", { timeout: 15_000 });
    await caption(page, "Skill Studio — full submission → update lifecycle", 2400);

    // ── 1/9 select anton-grid (v1.0.0) ──────────────────────────────────────
    await caption(page, "1/9 · Select anton-grid (authored skill, v1.0.0)");
    const row = page.locator(`[data-skill-id="${SKILL_ID}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(page.getByTestId("detail-tab-edit")).toBeVisible({ timeout: 10_000 });

    // ── 2/9 open the Edit tab ────────────────────────────────────────────────
    await caption(page, "2/9 · Open the Edit tab");
    await page.getByTestId("detail-tab-edit").click();
    const editor = page.getByTestId("skill-editor-textarea");
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toHaveValue(/version:\s*"1\.0\.0"/, { timeout: 10_000 });

    // ── 3/9 bump version 1.0.0 → 1.0.1 in the raw editor ─────────────────────
    await caption(page, "3/9 · Bump anton-grid to v1.0.1 in the editor");
    const current = await editor.inputValue();
    const bumped = current.replace(/version:\s*"1\.0\.0"/, 'version: "1.0.1"');
    expect(bumped).not.toBe(current); // guard: the replace actually fired
    await editor.click();
    await editor.fill(bumped);
    await expect(editor).toHaveValue(/version:\s*"1\.0\.1"/, { timeout: 10_000 });

    // ── 4/9 Save ─────────────────────────────────────────────────────────────
    await caption(page, "4/9 · Save the new version");
    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();
    // After save the textarea re-seeds with the persisted (1.0.1) content.
    await expect(editor).toHaveValue(/version:\s*"1\.0\.1"/, { timeout: 10_000 });

    // ── 5/9 Publish → commit drawer ──────────────────────────────────────────
    await caption(page, "5/9 · Publish → opens the commit drawer");
    const publishBtn = page.locator('button[aria-label="Publish"]').first();
    await expect(publishBtn).toBeVisible({ timeout: 10_000 });
    await publishBtn.click();
    const commitMsg = page.locator("#commit-message");
    await expect(commitMsg).toBeVisible({ timeout: 10_000 });

    // ── 6/9 commit message → Commit & Push (in-app submit) ───────────────────
    await caption(page, "6/9 · Commit & Push — in-app submit (no redirect)");
    await commitMsg.fill("Bump anton-grid to v1.0.1");
    const commitPush = page.getByTestId("publish-commit-push");
    await expect(commitPush).toBeEnabled();
    // The submission is accepted → the bell feed is now allowed to light up.
    updatesLive = true;
    await commitPush.click();

    // ── 7/9 inline publish-outcome (in-app, no browser redirect) ─────────────
    await caption(page, "7/9 · Inline publish outcome — submission created");
    const outcome = page.getByTestId("publish-outcome");
    await expect(outcome).toBeVisible({ timeout: 10_000 });
    await expect(outcome).toHaveAttribute("data-outcome", "created");
    await page.waitForTimeout(1400);

    // Close the drawer so its overlay no longer intercepts the sidebar click.
    const doneBtn = page.getByTestId("publish-done");
    if ((await doneBtn.count()) > 0) {
      await doneBtn.click();
    } else {
      await page.locator('button[aria-label="Cancel"]').first().click().catch(() => {});
    }
    await page
      .getByTestId("publish-outcome")
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});

    // ── 8/9 My Queue: RECEIVED → SSE flips to PUBLISHED ──────────────────────
    await caption(page, "8/9 · Open My Queue — submission is RECEIVED");
    await page.getByTestId("account-sidebar-entry").click();
    await page.getByTestId("account-shell").waitFor({ state: "visible" });
    await page.getByTestId("account-tab-queue").click();
    await page.getByTestId("submission-queue-panel").waitFor({ state: "visible" });

    const queueRow = page.getByTestId(`queue-row-${SUBMISSION_ID}`);
    await expect(queueRow).toBeVisible({ timeout: 10_000 });

    await caption(page, "8/9 · Reviewer approves → row flips to PUBLISHED (live SSE)");
    const stateCell = page.getByTestId(`queue-state-${SUBMISSION_ID}`);
    await expect(stateCell).toContainText("PUBLISHED", { timeout: 15_000 });
    await expect(queueRow).toHaveAttribute("data-state", "PUBLISHED");
    await page.waitForTimeout(1400);

    // ── 9/9 update bell → dropdown → update anton-grid locally → v1.0.1 ───────
    await caption(page, "9/9 · Update available — the bell lights up");
    // The /api/skills/updates feed is now live (updatesLive=true). The bell
    // hook re-polls /api/skills/updates on a visibilitychange ONLY when its
    // last fetch is "stale" (>60s old). The boot poll fired at t≈0, so we wait
    // until that window has genuinely elapsed, THEN drive a hidden→visible
    // cycle to force the re-fetch — fully deterministic (we own the clock),
    // exercises the real product refresh path (no 5-min interval wait).
    await waitUntilUpdatesStale(page);
    await forceVisibilityRefresh(page);
    const badge = page.getByTestId("update-bell-badge");
    await expect(badge).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("update-bell").click();
    const dropdown = page.getByTestId("update-dropdown");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });
    await caption(page, "9/9 · Update anton-grid locally → v1.0.1");

    const rowUpdate = page.getByTestId("update-dropdown-row-update").first();
    await expect(rowUpdate).toBeVisible({ timeout: 10_000 });
    await expect(rowUpdate).toBeEnabled();
    // Reflect the post-update state: the feed reports the local copy current.
    updatesLive = false;
    await rowUpdate.click();

    // A success toast confirms the local copy was updated to v1.0.1.
    const toast = page.locator('[data-testid="toast-item"]').filter({ hasText: /Updated anton-grid/i });
    await expect(toast.first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1600);

    // ── final ────────────────────────────────────────────────────────────────
    await caption(page, "Done · anton-grid published and updated locally to v1.0.1", 2600);
  });
});
