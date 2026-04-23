// ---------------------------------------------------------------------------
// 0683 T-011: End-to-end — Studio update notifications full flow.
//
// Covers: sidebar row glyph, section-header update chip, TopRail bell +
// count badge, bell-dropdown list + bump-dots, detail-panel "Update to
// X.Y.Z" button, inline SSE progress, success toast, badge decrement.
//
// /api/skills/updates is stubbed via `page.route` so the test does not
// depend on the backing skill source having a "newer" remote version.
// The single-skill SSE update endpoint is also stubbed so we can control
// the success trajectory deterministically.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

test.describe("0683 — update notifications full flow", () => {
  test("badge / chip / glyph → dropdown → detail action → done → badge decrements", async ({ page }) => {
    // Mutable fixture so the second poll returns the post-update list.
    let updatesFixture = [
      {
        name: "test-plugin/test-skill",
        installed: "1.0.0",
        latest: "2.0.0",
        updateAvailable: true,
      },
    ];

    await page.route("**/api/skills/updates", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(updatesFixture),
      });
    });

    // Intercept the single-skill SSE update — emit `progress` then `done`.
    await page.route("**/api/skills/test-plugin/test-skill/update", async (route) => {
      // After emitting `done`, flip the fixture so the next /api/skills/updates
      // poll returns an empty list and the badge decrements.
      const body = [
        `event: progress\ndata: ${JSON.stringify({ status: "updating" })}\n\n`,
        `event: progress\ndata: ${JSON.stringify({ status: "installing" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`,
      ].join("");
      updatesFixture = [];
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    await page.goto("/");

    // Studio should load the fixture skill in the sidebar first.
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible();

    // Bell badge reflects updateCount=1 after the initial poll.
    const badge = page.getByTestId("update-bell-badge");
    await expect(badge).toHaveText("1");

    // The installed-section header carries the `N updates ▾` chip.
    const chip = page.getByTestId("sidebar-section-update-chip").first();
    await expect(chip).toContainText("1 updates");

    // The outdated row carries the subtle `↑` glyph.
    await expect(page.getByTestId("skill-row-update-glyph")).toBeVisible();

    // Open the bell dropdown and verify the summary row + bump dot.
    await page.getByTestId("update-bell").click();
    await expect(page.getByTestId("update-dropdown")).toBeVisible();
    const dropRow = page.getByTestId("update-dropdown-row").first();
    await expect(dropRow).toContainText("test-plugin/test-skill");
    const bumpDot = page.getByTestId("update-dropdown-bump-dot").first();
    await expect(bumpDot).toHaveAttribute("data-bump", "major");

    // Click the dropdown row → the main sidebar selects the skill and the
    // dropdown closes.
    await dropRow.click();
    await expect(page.getByTestId("update-dropdown")).toHaveCount(0);

    // The detail panel now renders "Update to 2.0.0".
    const updateButton = page.getByTestId("update-action-button");
    await expect(updateButton).toHaveText("Update to 2.0.0");

    // Click Update → button flips to "Updating…", SSE emits progress + done,
    // success toast appears, badge eventually disappears.
    await updateButton.click();
    await expect(updateButton).toHaveText(/Updating/);

    // Success toast. ToastProvider renders with `data-testid="toast-item"`.
    const toast = page.getByTestId("toast-item");
    await expect(toast.first()).toContainText("Updated test-skill.");

    // Badge decrements — after refreshUpdates picks up the empty fixture.
    await expect(page.getByTestId("update-bell-badge")).toHaveCount(0);
  });
});
