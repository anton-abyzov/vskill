// 0756 — BEFORE/AFTER proof: same TestLab project, same skills, two studios.
//   port 3136 = user's running OLD vskill build (npx-cached, pre-fix)
//   port 3138 = local fixed build (this branch's dist)
// Captures matched screenshots and prints the version each renders for the
// flagged user-personal skills, side by side.

import { test, expect, type Page } from "@playwright/test";

const REPORTS =
  "/Users/antonabyzov/Projects/github/specweave-umb/.specweave/increments/0756-fix-zero-zero-zero-version-sentinel/reports";

const FLAGGED = [
  "excalidraw-diagram-generator",
  "excalidraw-skill",
  "frontend-design",
  "nanobanana",
  "pptx",
  "social-media-posting",
  "tax-filing",
  "webapp-testing",
];

async function loadAndExpand(page: Page, base: string) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("text=AVAILABLE").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(3000);
  // Expand PERSONAL → CLAUDE-CODE so the flagged rows are visible.
  for (const label of ["PERSONAL", "CLAUDE-CODE"]) {
    const target = page.locator(`text=/^${label}$/`).first();
    if (await target.count()) {
      await target.scrollIntoViewIfNeeded();
      await target.click({ force: true });
      await page.waitForTimeout(400);
    }
  }
  // Bring the first flagged row into view.
  const first = page.locator(`text=${FLAGGED[0]}`).first();
  await first.waitFor({ state: "visible", timeout: 8000 });
  await first.scrollIntoViewIfNeeded();
}

async function readVersions(page: Page): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const name of FLAGGED) {
    const row = page.locator(`text=${name}`).first();
    const badge = row
      .locator('xpath=ancestor::*[self::button or self::a][1]')
      .locator('[data-testid="skill-row-version"]')
      .first();
    out[name] = (await badge.getAttribute("data-version").catch(() => null)) ?? null;
  }
  return out;
}

test("0756 BEFORE: port 3136 (user's old npx vskill build)", async ({ page }) => {
  await loadAndExpand(page, "http://localhost:3136");
  await page.screenshot({ path: `${REPORTS}/before-port-3136-old-build.png`, fullPage: true });
  const versions = await readVersions(page);
  console.log("\n=== BEFORE (port 3136 — OLD build) ===");
  for (const name of FLAGGED) {
    console.log(`  ${name.padEnd(35)} v${versions[name]}`);
  }
  // No assertion — this is the baseline capture; we expect 0.0.0 here.
});

test("0756 AFTER: port 3138 (local fixed build)", async ({ page }) => {
  await loadAndExpand(page, "http://localhost:3138");
  await page.screenshot({ path: `${REPORTS}/after-port-3138-fixed-build.png`, fullPage: true });
  const versions = await readVersions(page);
  console.log("\n=== AFTER (port 3138 — FIXED build) ===");
  for (const name of FLAGGED) {
    console.log(`  ${name.padEnd(35)} v${versions[name]}`);
    expect(versions[name], `${name} must NOT be 0.0.0`).not.toBe("0.0.0");
  }
});
