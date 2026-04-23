// ---------------------------------------------------------------------------
// T-055: Lighthouse CI FCP / TTI budget assertion (smoke variant).
//
// The full Lighthouse run lives in `lighthouse.config.js` and is invoked via
// `npm run test:lhci` — that path uses the real Lighthouse audit pipeline
// with CPU + network throttling to produce FCP/TTI values comparable to the
// scope brief (mid-range laptop, CPU 4×, Fast 3G).
//
// This Playwright spec is a lightweight guard that runs alongside the other
// E2E tests so CI catches gross regressions even when Lighthouse is not
// wired into the workflow. It reads:
//
//   • FCP via `PerformancePaintTiming` (`first-contentful-paint`)
//   • A TTI-proxy via `PerformanceNavigationTiming.domInteractive` — this is
//     NOT the full Lighthouse TTI algorithm (which weighs long-tasks + long
//     network requests) but serves as a smoke budget. The authoritative TTI
//     assertion stays in `test:lhci`.
//
// Budgets are intentionally slightly looser than the Lighthouse budgets
// (FCP ≤ 1000ms, DOM interactive ≤ 2000ms) because this spec runs against
// the `eval serve` dev-ish server (not a production `vite preview`). The
// real authoritative numbers come from `test:lhci`.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

// Smoke budgets — intentionally generous; authoritative budgets in lighthouse.config.js.
const FCP_SMOKE_BUDGET_MS = 1000;
const DOM_INTERACTIVE_SMOKE_BUDGET_MS = 2000;

test.describe("T-055 — Lighthouse budget smoke (proxy via PerformanceTimeline)", () => {
  test("FCP is reported within the smoke budget", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("input[type='search']");

    const fcp = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        "paint",
      ) as PerformancePaintTiming[];
      const entry = entries.find((e) => e.name === "first-contentful-paint");
      return entry?.startTime ?? null;
    });

    expect(fcp, "no FCP entry reported by the browser").not.toBeNull();
    expect.soft(fcp!, `FCP=${fcp}ms`).toBeLessThanOrEqual(FCP_SMOKE_BUDGET_MS);
    // Hard ceiling 2× budget — catches huge regressions without tripping on
    // cold-start variance.
    expect(fcp!).toBeLessThanOrEqual(FCP_SMOKE_BUDGET_MS * 2);
  });

  test("DOM interactive is reported within the smoke budget", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("input[type='search']");

    const domInteractive = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        "navigation",
      ) as PerformanceNavigationTiming[];
      if (entries.length === 0) return null;
      return entries[0].domInteractive;
    });

    expect(domInteractive, "no navigation entry reported").not.toBeNull();
    expect
      .soft(
        domInteractive!,
        `DOM interactive=${domInteractive}ms`,
      )
      .toBeLessThanOrEqual(DOM_INTERACTIVE_SMOKE_BUDGET_MS);
    expect(domInteractive!).toBeLessThanOrEqual(
      DOM_INTERACTIVE_SMOKE_BUDGET_MS * 2,
    );
  });
});
