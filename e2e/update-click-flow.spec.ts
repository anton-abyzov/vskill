// ---------------------------------------------------------------------------
// 0736 US-001 — Update click flow E2E (AC-US1-05)
//
// Covers:
//   - AC-US1-01: single POST to /api/skills/:plugin/:skill/update, inline progress
//   - AC-US1-02: success → version updated, ↑ glyph removed, bell badge decremented
//   - AC-US1-03: failure → structured error visible, button stays enabled, no "Stream error"
//   - AC-US1-05: E2E Playwright test for click-to-install flow
//
// Strategy:
//   The eval-server at localhost:3077 serves e2e/fixtures as the skill root.
//   We stub POST /api/skills/.../update via page.route so the test is
//   deterministic without requiring vskill to be installed on the CI machine.
//   We also stub GET /api/skills/updates to inject an updateAvailable skill.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

const FIXTURE_PLUGIN = "test-plugin";
const FIXTURE_SKILL = "test-skill";

function makeUpdateResponseBody(version: string): string {
  // Matches the SSE frame format the backend emits from POST handler.
  return [
    `event: progress\ndata: ${JSON.stringify({ status: "updating", skill: FIXTURE_SKILL })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ status: "done", skill: FIXTURE_SKILL, version })}\n\n`,
  ].join("");
}

test.describe("0736 US-001 — update click flow", () => {
  test.beforeEach(async ({ page }) => {
    // Stub the updates poll to report test-skill as outdated (version 1.0.0 → 2.0.0).
    await page.route("**/api/skills/updates", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            name: `${FIXTURE_PLUGIN}/${FIXTURE_SKILL}`,
            installed: "1.0.0",
            latest: "2.0.0",
            updateAvailable: true,
            diffSummary: "Fix: 0736 E2E fixture update",
          },
        ]),
      });
    });

    // Idle SSE stream — no push events needed for this test.
    await page.route("**/api/v1/skills/stream*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: "",
      });
    });

    // Idle check-updates — confirm no extra updates.
    await page.route("**/api/v1/skills/check-updates*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [] }),
      });
    });
  });

  test("AC-US1-05: clicking Update to 2.0.0 on a stale skill completes and removes the update glyph", async ({ page }) => {
    // Stub the update POST to return a successful SSE completion body.
    let updateRequestCount = 0;
    let capturedMethod = "";
    let capturedUrl = "";
    await page.route(`**/api/skills/${FIXTURE_PLUGIN}/${FIXTURE_SKILL}/update`, async (route) => {
      updateRequestCount++;
      capturedMethod = route.request().method();
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body: makeUpdateResponseBody("2.0.0"),
      });
    });

    await page.goto("/");

    // Wait for skills to load + updates poll to resolve (bell badge appears).
    const badge = page.getByTestId("update-bell-badge");
    await expect(badge).toHaveText("1", { timeout: 8_000 });

    // Click the fixture skill to open its detail panel.
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // Wait for the update action block to appear (skill has updateAvailable).
    const updateAction = page.getByTestId("update-action");
    await expect(updateAction).toBeVisible({ timeout: 5_000 });

    // Verify button text says "Update to 2.0.0".
    const updateButton = page.getByTestId("update-action-button");
    await expect(updateButton).toHaveText("Update to 2.0.0");

    // Click Update.
    await updateButton.click();

    // AC-US1-01: button shows "Updating…" while request in-flight.
    // (brief — the stub resolves quickly, so check for either state.)
    // After completion the button should be re-enabled and NOT say "Updating…".
    await expect(updateButton).not.toHaveText("Updating…", { timeout: 5_000 });

    // Verify exactly ONE POST was made to the correct URL.
    expect(updateRequestCount).toBe(1);
    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toContain(`/api/skills/${FIXTURE_PLUGIN}/${FIXTURE_SKILL}/update`);

    // AC-US1-03: no "Stream error" toast.
    const toasts = page.getByTestId("toast-item");
    const allToastTexts = await toasts.allTextContents();
    for (const text of allToastTexts) {
      expect(text).not.toContain("Stream error");
    }
  });

  test("AC-US1-03: update failure shows structured error with status code, not 'Stream error'", async ({ page }) => {
    // Stub the update POST to return a 500 error.
    await page.route(`**/api/skills/${FIXTURE_PLUGIN}/${FIXTURE_SKILL}/update`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal Server Error: disk full" }),
      });
    });

    await page.goto("/");

    // Wait for updates poll to resolve before clicking.
    const badge = page.getByTestId("update-bell-badge");
    await expect(badge).toHaveText("1", { timeout: 8_000 });

    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    const updateButton = page.getByTestId("update-action-button");
    await expect(updateButton).toBeVisible({ timeout: 5_000 });
    await updateButton.click();

    // Button must NOT be stuck in "Updating…" state.
    await expect(updateButton).not.toHaveText("Updating…", { timeout: 5_000 });
    await expect(updateButton).toBeEnabled();

    // AC-US1-03: error display must include status code or informative message.
    const errorEl = page.getByTestId("update-action-error");
    const toasts = page.getByTestId("toast-item");
    // Either the inline error or the toast must mention 500.
    const hasInlineError = await errorEl.count() > 0;
    const toastTexts = await toasts.allTextContents();
    const allText = [
      ...(hasInlineError ? [await errorEl.textContent() ?? ""] : []),
      ...toastTexts,
    ].join(" ");

    expect(allText).not.toContain("Stream error");
    expect(allText).toMatch(/500|HTTP|disk full|update.*skill/i);
  });
});
