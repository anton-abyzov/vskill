import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0707 T-012: Overview metric grid responds cleanly at the 4 breakpoints.
//
// For each viewport width we check that the `.skill-overview-grid` has no
// horizontally-overflowing metric cards (scrollWidth <= clientWidth for
// every metric-* card).
// ---------------------------------------------------------------------------

const VIEWPORTS: Array<{ width: number; height: number; label: string }> = [
  { width: 480, height: 800, label: "mobile" },
  { width: 768, height: 1024, label: "tablet" },
  { width: 1024, height: 768, label: "laptop" },
  { width: 1440, height: 900, label: "desktop" },
];

test.describe("0707 studio detail — responsive overview grid", () => {
  for (const vp of VIEWPORTS) {
    test(`overview grid has no overflowing cards at ${vp.label} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      const row = page.getByRole("button", { name: /test-skill/ }).first();
      await expect(row).toBeVisible();
      await row.click();

      const overview = page.getByTestId("skill-overview-grid");
      await expect(overview).toBeVisible();

      const metrics = page.locator('[data-testid^="metric-"]');
      const overflows = await metrics.evaluateAll((els: Element[]) =>
        (els as HTMLElement[])
          .filter((el) => el.dataset.testid && !el.dataset.testid.endsWith("-title") && !el.dataset.testid.endsWith("-value"))
          .map((el) => ({
            id: el.dataset.testid,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          })),
      );
      for (const m of overflows) {
        expect(m.scrollWidth, `${m.id} overflowed at ${vp.label}`).toBeLessThanOrEqual(m.clientWidth + 1);
      }
    });
  }
});
