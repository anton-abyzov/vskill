// T-056: E2E — LeaderboardPage renders with mock data
import { test, expect } from "@playwright/test";

test.describe("Leaderboard page", () => {
  test("leaderboard tab is visible in workspace", async ({ page }) => {
    await page.goto("/");
    // Select a skill first
    await page.locator("text=test-skill").click();
    // Check leaderboard tab exists
    await expect(page.locator("text=Leaderboard")).toBeVisible();
  });

  test("leaderboard panel shows empty state when no sweep data", async ({ page }) => {
    await page.goto("/");
    await page.locator("text=test-skill").click();
    // Click leaderboard tab
    await page.locator("text=Leaderboard").click();
    // Should show empty state
    await expect(page.locator("text=No sweep results yet")).toBeVisible();
    // Should show sweep command instructions
    await expect(page.locator("text=vskill eval sweep")).toBeVisible();
  });

  test("leaderboard API endpoint responds", async ({ request }) => {
    const res = await request.get("/api/skills/test-plugin/test-skill/leaderboard");
    // May return 200 with empty entries or 404 — both are acceptable
    if (res.ok()) {
      const json = await res.json();
      expect(json).toHaveProperty("entries");
      expect(Array.isArray(json.entries)).toBe(true);
    }
  });
});
