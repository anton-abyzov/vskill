import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0707 T-011: Flat 9-tab bar is reachable without scrolling at 1440x900.
//
// After the redesign, Overview / Editor / Tests / Run / Activation / History
// / Leaderboard / Deps / Versions must all fit in a single horizontal tab
// bar above the fold when the viewport is 1440×900 and a skill is selected.
// ---------------------------------------------------------------------------

test.describe("0707 studio detail — flat 9-tab bar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("all 9 tab buttons are visible without vertical scrolling", async ({ page }) => {
    await page.goto("/");

    // Select the seeded fixture skill.
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible();
    await row.click();

    // Assert every tab button exists and sits inside the viewport.
    const tabIds = [
      "detail-tab-overview",
      "detail-tab-editor",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-activation",
      "detail-tab-history",
      "detail-tab-leaderboard",
      "detail-tab-deps",
      "detail-tab-versions",
    ];
    for (const id of tabIds) {
      const btn = page.getByTestId(id);
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      if (!box) throw new Error(`${id} has no bounding box`);
      expect(box.y + box.height).toBeLessThan(900);
    }
  });

  test("deep-link via ?panel=tests mounts the Tests tab by default", async ({ page }) => {
    await page.goto("/?panel=tests");
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible();
    await row.click();

    const tabsBtn = page.getByTestId("detail-tab-tests");
    await expect(tabsBtn).toHaveAttribute("aria-selected", "true");
  });
});
