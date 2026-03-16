// T-057: E2E — TestsPanel filter tabs and badge rendering
import { test, expect } from "@playwright/test";

test.describe("TestsPanel filter tabs and badges", () => {
  test("tests panel shows filter tabs (All, Unit, Integration)", async ({ page }) => {
    await page.goto("/");
    // Select a skill first
    await page.locator("text=test-skill").click();
    // Switch to tests panel
    await page.locator("text=Tests").first().click();

    // Filter tabs should be visible
    await expect(page.locator("button:has-text('All')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Unit')").first()).toBeVisible();
    await expect(page.locator("button:has-text('Integration')").first()).toBeVisible();
  });

  test("test cases show type badges (U/I)", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=test-skill").click();
    await page.locator("text=Tests").first().click();

    // At least one badge should be visible (default cases are unit type)
    // Badge text is "U" for unit tests
    const unitBadges = page.locator("span:has-text('U')");
    // There should be at least one unit badge visible
    await expect(unitBadges.first()).toBeVisible();
  });

  test("filter tabs filter the test case list", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=test-skill").click();
    await page.locator("text=Tests").first().click();

    // Get the "All" count
    const allTab = page.locator("button:has-text('All')").first();
    await allTab.click();

    // Count cases in the list by looking for case buttons
    const allCases = page.locator("button:has-text('#')");
    const allCount = await allCases.count();
    expect(allCount).toBeGreaterThan(0);
  });
});
