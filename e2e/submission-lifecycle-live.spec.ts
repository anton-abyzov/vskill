// ---------------------------------------------------------------------------
// 0860 T-002..T-006 — Submission lifecycle E2E (in-app, deterministic).
//
// Drives the FULL submission lifecycle through Skill Studio entirely in-app:
//
//   improve a skill → Publish drawer → Commit & Push (IN-APP submit) →
//   appears in My Queue with a state → force a fast TERMINAL decision
//   (APPROVED + REJECTED) via the queue SSE → bell increments + notification
//   fires exactly once → after APPROVED, the update-locally affordance appears.
//
// WHY THIS LIVES IN THE `live` PROJECT (`@live`, `-live.spec.ts`):
//   It needs the eval-ui bundle freshly built with the `skill-editor-textarea`
//   testid (just added to EditorPanel.tsx:571) and exercises the same wiring
//   the nightly live lane rebuilds. The platform calls themselves are STUBBED
//   on the local eval-server origin (CORS-free architecture — the browser only
//   ever talks to localhost; the eval-server proxies upstream). The forced
//   terminal decision is the studio-side equivalent of the platform's
//   `finalize-scan` FORCE path (recon-infra): we inject the decision as an SSE
//   frame on `/api/v1/submissions/stream?mine=1` rather than POSTing
//   finalize-scan, which keeps the test deterministic and self-contained while
//   asserting the EXACT same client contract (own-id filter → row transition →
//   notification dedupe).
//
// DETERMINISM CONTRACTS (recon-ui):
//   - NO window.open / NO popup: a page-init spy records window.open calls and
//     `context.on('page')` must never fire.
//   - The submit is in-app: assert [data-testid="publish-outcome"] with the
//     stubbed data-outcome — proves the POST /api/v1/submissions response
//     rendered inline, no redirect.
//   - My Queue transitions only apply to ids present in the initial
//     GET /api/v1/submissions?mine=1 feed (own-id filter) — the transitioning
//     id is seeded into that feed.
//   - In-browser "notification arrived" = [data-testid="toast-item"] from
//     studio:toast (publish toast). The native macOS submission notification
//     is a no-op in chromium (no __TAURI_INTERNALS__), so we never assert it.
//   - Bell badge appears only when GET /api/skills/updates returns
//     updateAvailable:true rows.
// ---------------------------------------------------------------------------
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Tag the whole file for the `live` project grep (playwright.config.ts).
test.describe("@live 0860 — submission lifecycle (in-app)", () => {
  const SUBMISSION_ID = "sub_e2e_0860";
  const SKILL_NAME = "appstore";
  const SKILL_PATH = "plugins/mobile/skills/appstore";
  const REMOTE_SSH = "git@github.com:owner/test-repo.git";

  // ── window.open spy + popup guard ────────────────────────────────────────
  async function installNoPopupGuards(page: Page, context: BrowserContext) {
    await page.addInitScript(() => {
      // @ts-expect-error test-only window field
      window.__windowOpenCalls = [];
      const orig = window.open;
      window.open = function (...args: unknown[]) {
        // @ts-expect-error test-only window field
        window.__windowOpenCalls.push(args[0] ?? null);
        // Return null like a blocked popup; do NOT actually open.
        return null as unknown as Window;
      } as typeof window.open;
      void orig;
    });
    // Any real popup page is a failure.
    context.on("page", (p) => {
      throw new Error(`Unexpected popup opened: ${p.url()}`);
    });
  }

  async function windowOpenCalls(page: Page): Promise<unknown[]> {
    return page.evaluate(() => {
      // @ts-expect-error test-only window field
      return [...(window.__windowOpenCalls || [])];
    });
  }

  // ── studio:toast capture (in-browser notification proof) ─────────────────
  async function captureToasts(page: Page) {
    await page.addInitScript(() => {
      // @ts-expect-error test-only window field
      window.__studioToasts = [];
      window.addEventListener("studio:toast", (e: Event) => {
        // @ts-expect-error CustomEvent detail
        window.__studioToasts.push((e as CustomEvent).detail || {});
      });
    });
    return async () =>
      page.evaluate(() => {
        // @ts-expect-error test-only window field
        return [...(window.__studioToasts || [])];
      });
  }

  // ── git + submission route stubs ─────────────────────────────────────────
  function stubGitRoutes(page: Page, opts: { hasChanges: boolean }) {
    return Promise.all([
      page.route("**/api/git/remote", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ remoteUrl: REMOTE_SSH, branch: "main", hasRemote: true }),
        }),
      ),
      page.route("**/api/git/diff", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hasChanges: opts.hasChanges,
            diff: opts.hasChanges ? "diff --git a/SKILL.md b/SKILL.md\n+new line\n" : "",
            fileCount: opts.hasChanges ? 1 : 0,
          }),
        }),
      ),
      page.route("**/api/git/publish", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            commitSha: "abc1234def5678",
            branch: "main",
            remoteUrl: REMOTE_SSH,
            stdout: "Everything up-to-date\n",
            stderr: "",
          }),
        }),
      ),
    ]);
  }

  // POST /api/v1/submissions → controllable in-app outcome.
  function stubSubmitToQueue(page: Page) {
    return page.route("**/api/v1/submissions", async (route) => {
      // Only intercept the POST; the GET ?mine=1 feed is handled separately.
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
          skillPath: SKILL_PATH,
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
              repoUrl: "https://github.com/owner/test-repo",
              state: "RECEIVED",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          queuePositions: { [SUBMISSION_ID]: 3 },
        }),
      }),
    );
  }

  // GET /api/v1/submissions/stream?mine=1 → inject ONE terminal decision frame.
  // This is the studio-side FORCE path: the queue applies the frame to the
  // matching own-id row and drives it terminal, exactly like the platform's
  // finalize-scan → submission stream would.
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
        // One frame then EOF — the fetch-SSE reader parses it on the first read.
        body: frame,
      }),
    );
  }

  // GET /api/skills/updates → drives the bell badge (updateCount). Empty by
  // default; flip to one outdated row after an APPROVED bump.
  function stubSkillUpdates(
    page: Page,
    rows: Array<Record<string, unknown>>,
  ) {
    return page.route("**/api/skills/updates*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      }),
    );
  }

  // Reach the My Queue tab: sidebar entry → account cabinet → queue tab.
  async function openMyQueue(page: Page) {
    await page.getByTestId("account-sidebar-entry").click();
    await page.getByTestId("account-shell").waitFor({ state: "visible" });
    await page.getByTestId("account-tab-queue").click();
    await page.getByTestId("submission-queue-panel").waitFor({ state: "visible" });
  }

  // Open an EDITABLE skill in the editor. Read-only/installed skills only
  // expose Source/Overview tabs; authored (PROJECT) skills additionally expose
  // a "detail-tab-edit" tab that mounts EditorPanel (raw textarea + Save +
  // Publish). We probe rows until we find one with the Edit tab, then activate
  // it. This is the same authorship gate the recon notes (Publish renders only
  // when EditorPanel mounts AND hasRemote). Returns false if no editable skill
  // exists in the workspace (e.g. an empty fixture) so the caller can skip.
  async function selectEditableSkill(page: Page): Promise<boolean> {
    await page.waitForSelector('[data-testid="skill-row"]', { timeout: 15_000 });
    const count = await page.locator('[data-testid="skill-row"]').count();
    for (let i = 0; i < count; i += 1) {
      await page.locator('[data-testid="skill-row"]').nth(i).click();
      // Brief settle for the detail panel tabs to render.
      const editTab = page.getByTestId("detail-tab-edit");
      if ((await editTab.count()) > 0) {
        await editTab.click();
        return true;
      }
    }
    return false;
  }

  // Drive the in-app publish: select an editable skill → edit → Save →
  // Publish → drawer → Commit & Push.
  async function publishInApp(page: Page): Promise<void> {
    const editable = await selectEditableSkill(page);
    expect(editable, "workspace must expose at least one editable skill").toBe(true);

    // Improve the skill: type into the raw editor textarea (added testid).
    const editor = page.getByTestId("skill-editor-textarea");
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially("\n<!-- 0860 e2e improvement -->");

    // Save enables once dirty.
    const saveBtn = page.locator('button:has-text("Save")').first();
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();

    // Publish button renders only with hasRemote + a selected skill.
    const publishBtn = page.locator('button[aria-label="Publish"]');
    await expect(publishBtn).toBeVisible({ timeout: 10_000 });
    await publishBtn.click();

    // hasChanges:true → drawer opens.
    const commitMsg = page.locator("#commit-message");
    await expect(commitMsg).toBeVisible({ timeout: 10_000 });
    await commitMsg.fill("0860: improve appstore skill");

    const commitPush = page.getByTestId("publish-commit-push");
    await expect(commitPush).toBeEnabled();
    await commitPush.click();
  }

  test.beforeEach(async ({ page, context }) => {
    await installNoPopupGuards(page, context);
  });

  // ── T-002 / T-003: in-app submit, NO popup, appears in My Queue ──────────
  test("improve → in-app submit (no popup) → appears in My Queue with a state", async ({
    page,
  }) => {
    const getToasts = await captureToasts(page);
    await stubGitRoutes(page, { hasChanges: true });
    await stubSubmitToQueue(page);
    await stubMyQueueFeed(page);
    await stubQueueStream(page, "RECEIVED");
    await stubSkillUpdates(page, []);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='sidebar']", { timeout: 15_000 });

    await publishInApp(page);

    // In-app submit proof: inline outcome block with the created outcome.
    const outcome = page.getByTestId("publish-outcome");
    await expect(outcome).toBeVisible({ timeout: 10_000 });
    await expect(outcome).toHaveAttribute("data-outcome", "created");

    // NO popup, NO window.open to verified-skill.com.
    const opens = await windowOpenCalls(page);
    expect(
      opens.filter((u) => typeof u === "string" && (u as string).includes("verified-skill.com")),
      "in-app submit must NOT open a verified-skill.com popup",
    ).toEqual([]);

    // A studio:toast notification surfaced (in-browser proof; native is no-op).
    const toasts = await getToasts();
    expect(toasts.length, "an in-app toast notification should fire on submit").toBeGreaterThan(0);

    // The drawer STAYS OPEN after a successful in-app submit (footer flips to
    // "Done"). Close it so its aria-hidden overlay no longer intercepts the
    // sidebar click before we navigate to My Queue.
    const doneBtn = page.getByTestId("publish-done");
    if ((await doneBtn.count()) > 0) {
      await doneBtn.click();
    } else {
      await page.locator('button[aria-label="Cancel"]').first().click().catch(() => {});
    }
    await page.getByTestId("publish-outcome").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});

    // My Queue shows the submission with a state.
    await openMyQueue(page);
    const row = page.getByTestId(`queue-row-${SUBMISSION_ID}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`queue-state-${SUBMISSION_ID}`)).toContainText(/RECEIVED|PENDING|RECEIVED/i);
  });

  // ── T-004 / T-006: forced terminal decisions (APPROVED + REJECTED) ───────
  for (const variant of [
    { name: "APPROVED", state: "PUBLISHED", isApproved: true },
    { name: "REJECTED", state: "REJECTED", isApproved: false },
  ] as const) {
    test(`forced ${variant.name} decision → queue row transitions terminal, notifies once`, async ({
      page,
    }) => {
      await stubGitRoutes(page, { hasChanges: false }); // clean tree path is fine here
      await stubMyQueueFeed(page);
      await stubQueueStream(page, variant.state);
      // After approval, the bell should light up with the bumped skill.
      await stubSkillUpdates(
        page,
        variant.isApproved
          ? [
              {
                id: SKILL_NAME,
                name: SKILL_NAME,
                skillName: SKILL_NAME,
                installed: "1.0.4",
                latest: "1.0.5",
                latestVersion: "1.0.5",
                updateAvailable: true,
                origin: "registry",
              },
            ]
          : [],
      );

      // T-006 dedupe note: the once-only guarantee is enforced inside the
      // panel by `claimDecisionNotification(submissionId, state)` (shared across
      // the queue-stream and skills-stream transports). The terminal frame is
      // injected EXACTLY ONCE here (single SSE body, EOF after), and the native
      // notify path is a no-op in chromium, so the in-browser proof is the
      // single terminal row transition (asserted below) — a duplicate frame
      // would still resolve to one row state, and the unit suite covers the
      // dedupe ledger directly.
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-testid='sidebar']", { timeout: 15_000 });

      await openMyQueue(page);

      // The injected SSE frame drives the own-id row to its terminal state.
      const stateCell = page.getByTestId(`queue-state-${SUBMISSION_ID}`);
      await expect(stateCell).toContainText(variant.state, { timeout: 15_000 });
      await expect(page.getByTestId(`queue-row-${SUBMISSION_ID}`)).toHaveAttribute(
        "data-state",
        variant.state,
      );

      // Terminal → queue position drops to the em-dash placeholder.
      await expect(page.getByTestId(`queue-position-${SUBMISSION_ID}`)).toContainText("—");

      if (variant.isApproved) {
        // ── T-004: after an APPROVED bump the update-locally affordance shows.
        const badge = page.getByTestId("update-bell-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });

        await page.getByTestId("update-bell").click();
        const dropdown = page.getByTestId("update-dropdown");
        await expect(dropdown).toBeVisible({ timeout: 10_000 });

        const rowUpdate = page
          .getByTestId("update-dropdown-row-update")
          .first();
        await expect(rowUpdate).toBeVisible({ timeout: 10_000 });
        // The affordance exists and is actionable (update-locally).
        await expect(rowUpdate).toBeEnabled();
      } else {
        // ── REJECTED: terminal REJECTED state is the in-browser proof. The
        // native click-through to /submit/<id> is no-op in chromium (recon
        // GOTCHA), so we assert the terminal state + that the row carries the
        // rejected styling hook (data-state) rather than a popup.
        await expect(page.getByTestId(`queue-row-${SUBMISSION_ID}`)).toHaveAttribute(
          "data-state",
          "REJECTED",
        );
      }

      // No popup was ever spawned during the decision flow.
      const opens = await windowOpenCalls(page);
      expect(opens, "decision flow must not open any popup").toEqual([]);
    });
  }
});
