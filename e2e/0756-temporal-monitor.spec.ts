// 0756 — temporal monitor: catches the "flash 1.0.0 → revert 0.0.0" pattern
// the user reported. Uses page.evaluate() for fast in-DOM sampling so we don't
// burn the test budget on Playwright locator overhead.

import { test, expect } from "@playwright/test";

const STUDIO = "http://localhost:3138";
const REPORTS =
  "/Users/antonabyzov/Projects/github/specweave-umb/.specweave/increments/0756-fix-zero-zero-zero-version-sentinel/reports";

const TARGET = "frontend-design";

test("0756: NO badge anywhere on the page reads 0.0.0 across 12s of polling", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(`${STUDIO}/#/skills/claude-code/${TARGET}`, { waitUntil: "domcontentloaded" });
  await page.locator("text=AVAILABLE").first().waitFor({ timeout: 15000 });

  // Expand sidebar groups so all rows are mounted.
  for (const label of ["PERSONAL", "CLAUDE-CODE"]) {
    const t = page.locator(`text=/^${label}$/`).first();
    if (await t.count()) {
      await t.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
  }

  // Sample in-page; single round-trip per tick.
  const samples = await page.evaluate(async () => {
    type Sample = { t: number; total: number; offenders: number; detail: string | null; sidebarFD: string | null };
    const out: Sample[] = [];
    const start = Date.now();
    while (Date.now() - start < 12_000) {
      const all = Array.from(document.querySelectorAll<HTMLElement>("[data-version]"));
      const total = all.length;
      const offenders = all.filter((el) => el.getAttribute("data-version") === "0.0.0").length;
      const detail =
        document
          .querySelector('[data-testid="detail-header-version"] [data-testid="version-badge"]')
          ?.getAttribute("data-version") ?? null;
      // sidebar row for frontend-design — find any skill-row badge whose row text contains the target.
      let sidebarFD: string | null = null;
      for (const badge of Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="skill-row-version"]'),
      )) {
        const row = badge.closest("button, a") as HTMLElement | null;
        if (row && row.textContent?.includes("frontend-design")) {
          sidebarFD = badge.getAttribute("data-version");
          break;
        }
      }
      out.push({ t: Date.now() - start, total, offenders, detail, sidebarFD });
      await new Promise((r) => setTimeout(r, 1000));
    }
    return out;
  });

  console.log("\n=== TEMPORAL MONITOR (frontend-design) ===");
  console.log("t(ms)\ttotal\toffenders\tdetail\tsidebar(frontend-design)");
  for (const s of samples) {
    console.log(`${s.t}\t${s.total}\t${s.offenders}\t${s.detail}\t${s.sidebarFD}`);
  }

  await page.screenshot({ path: `${REPORTS}/temporal-monitor-final.png`, fullPage: true });

  const offendingTicks = samples.filter((s) => s.offenders > 0);
  if (offendingTicks.length) {
    console.log(`\n[0756] FLASH-REVERT — offenders detected at ${offendingTicks.length} tick(s)`);
  }
  expect(offendingTicks.length, "no badge may render v0.0.0 at any tick").toBe(0);
  expect(samples.some((s) => s.sidebarFD && s.sidebarFD !== "0.0.0")).toBe(true);
});
