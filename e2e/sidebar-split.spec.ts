import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// T-022: Playwright E2E — sidebar split renders with correct counts and
// collapse-state persistence.
//
// This spec uses the existing `eval serve --root e2e/fixtures` server which
// seeds a single "test-plugin/test-skill" source skill. For the counts
// assertion we look at the two section headers that are always present; the
// INSTALLED section will be 0 in this fixture and we validate the header is
// still rendered (empty-state microcopy visible).
// ---------------------------------------------------------------------------

test.describe("sidebar split", () => {
  test.beforeEach(async ({ context }) => {
    // Start each test with a clean localStorage so collapse defaults are honored.
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem("vskill-sidebar-own-collapsed");
        window.localStorage.removeItem("vskill-sidebar-installed-collapsed");
      } catch {
        /* ignore */
      }
    });
  });

  test("OWN and INSTALLED section headers render with counts", async ({ page }) => {
    await page.goto("/");

    // Both section headers are always rendered (installed empty-state still
    // shows a header so users know the split exists).
    const ownHeader = page.locator("button[data-testid='sidebar-section-header']", {
      hasText: "Own",
    });
    const installedHeader = page.locator("button[data-testid='sidebar-section-header']", {
      hasText: "Installed",
    });

    await expect(ownHeader).toBeVisible();
    await expect(installedHeader).toBeVisible();

    // Count is wrapped in parentheses — "(N)".
    await expect(ownHeader).toHaveText(/Own\s*\(\d+\)/);
    await expect(installedHeader).toHaveText(/Installed\s*\(\d+\)/);
  });

  test("collapse state for OWN section persists across reload", async ({ page }) => {
    await page.goto("/");

    const ownHeader = page.locator("button[data-testid='sidebar-section-header']", {
      hasText: "Own",
    });
    await expect(ownHeader).toHaveAttribute("aria-expanded", "true");

    // Collapse
    await ownHeader.click();
    await expect(ownHeader).toHaveAttribute("aria-expanded", "false");

    // Reload; localStorage key `vskill-sidebar-own-collapsed` is read on mount.
    await page.reload();

    const ownHeaderAfterReload = page.locator("button[data-testid='sidebar-section-header']", {
      hasText: "Own",
    });
    await expect(ownHeaderAfterReload).toHaveAttribute("aria-expanded", "false");

    // Re-expand
    await ownHeaderAfterReload.click();
    await expect(ownHeaderAfterReload).toHaveAttribute("aria-expanded", "true");
  });

  test("'/' shortcut focuses the sidebar search input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("input[type='search']");

    // Click on the body so no input has focus
    await page.click("header");

    await page.keyboard.press("/");
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName + ":" + (el.getAttribute("type") ?? "") : null;
    });
    expect(active).toBe("INPUT:search");
  });
});
