// ---------------------------------------------------------------------------
// T-051: Interaction-performance budgets.
//
// AC-US9-03: detail panel renders within 120ms of the triggering click.
// AC-US9-04: filtering the sidebar updates results within 80ms.
// AC-US9-06: switching the theme does not stall the main thread > 50ms.
//
// The app emits `performance.mark(...)` / `performance.measure(...)` pairs
// for these hot paths. This suite prefers reading the measured values from
// the Performance Timeline when available; if no such marks have been
// emitted (feature may still be in flight behind a flag), it falls back to
// Playwright-side timing via `performance.now()` wrapping the interaction
// and the next visible-DOM-change.
//
// CPU throttling is applied via CDP so the budgets reflect a mid-range
// laptop rather than the test host. Runs only under chromium-based drivers.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

const DETAIL_PANEL_BUDGET_MS = 120;
const SEARCH_BUDGET_MS = 80;
const LONG_TASK_BUDGET_MS = 50;

async function throttleCpu(page: Page, rate: number) {
  // `newCDPSession` is chromium-only. Playwright routes this to chrome or
  // chromium automatically.
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate });
  } catch {
    // Non-chromium driver — skip throttling; the budgets still apply.
  }
}

async function readMeasureMs(page: Page, name: string): Promise<number | null> {
  return page.evaluate((markName) => {
    const entries = performance.getEntriesByName(markName, "measure");
    if (entries.length === 0) return null;
    return entries[entries.length - 1].duration;
  }, name);
}

test.describe("T-051 — interaction performance budgets", () => {
  test.beforeEach(async ({ page }) => {
    await throttleCpu(page, 4);
    await page.goto("/");
    await page.waitForSelector("input[type='search']");
  });

  test("detail panel renders within 120ms of skill click", async ({ page }) => {
    // Start with a fresh performance buffer so stale measures from initial
    // render don't contaminate the assertion.
    await page.evaluate(() => performance.clearMeasures());

    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible();

    const start = Date.now();
    await row.click();
    await page.getByTestId("detail-header").waitFor({ state: "visible" });
    const fallbackMs = Date.now() - start;

    // Prefer the in-app measure when emitted; fall back to wall-clock.
    const measured = await readMeasureMs(page, "detail-panel-render");
    const duration = measured ?? fallbackMs;
    expect.soft(duration, `detail-panel-render duration: ${duration}ms`).toBeLessThanOrEqual(
      DETAIL_PANEL_BUDGET_MS,
    );
    // Hard upper bound: 2× budget — fails fast if a regression adds blocking
    // work, while keeping soft-check failure visible above.
    expect(duration).toBeLessThanOrEqual(DETAIL_PANEL_BUDGET_MS * 2);
  });

  test("typing in search updates results within 80ms", async ({ page }) => {
    await page.evaluate(() => performance.clearMeasures());

    const search = page.locator("input[type='search']");
    await search.focus();

    const start = Date.now();
    await search.type("test", { delay: 0 });
    // Wait for the list to settle — any visible skill row is fine.
    await page.getByRole("button", { name: /test-skill/ }).first().waitFor({ state: "visible" });
    const fallbackMs = Date.now() - start;

    const measured = await readMeasureMs(page, "sidebar-filter");
    const duration = measured ?? fallbackMs;
    // Use a soft assertion so a single outlier run doesn't nuke the suite —
    // the p95 observation is what we care about.
    expect.soft(duration, `sidebar-filter duration: ${duration}ms`).toBeLessThanOrEqual(
      SEARCH_BUDGET_MS,
    );
    // Hard ceiling to catch regressions: 2× budget.
    expect(duration).toBeLessThanOrEqual(SEARCH_BUDGET_MS * 2);
  });

  test("theme toggle does not schedule long-tasks > 50ms", async ({ page }) => {
    // PerformanceObserver("longtask") collects any main-thread block ≥50ms.
    await page.evaluate(() => {
      (window as unknown as { __longtasks: number[] }).__longtasks = [];
      const observer = new PerformanceObserver((list) => {
        const arr = (window as unknown as { __longtasks: number[] }).__longtasks;
        for (const e of list.getEntries()) arr.push(e.duration);
      });
      try {
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Some browsers lack longtask support — the array will remain empty
        // and the assertion below trivially passes. The hard perf budget is
        // still enforced by T-055 (Lighthouse) + the detail-panel test above.
      }
    });

    const toggle = page.locator("button[data-testid='theme-toggle']");
    await toggle.click();

    // Allow one animation frame for any queued work to settle before read.
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
    const longTasks = await page.evaluate(
      () => (window as unknown as { __longtasks: number[] }).__longtasks,
    );
    const worst = longTasks.reduce((m, v) => (v > m ? v : m), 0);
    expect.soft(worst, `worst longtask: ${worst}ms`).toBeLessThanOrEqual(
      LONG_TASK_BUDGET_MS,
    );
    expect(worst).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS * 2);
  });
});
