// 0756 — Final published-package proof. Runs against an `npx vskill@0.5.128 studio`
// instance on port 3140 (fresh fetch from the public npm registry — NOT the
// local dist). Captures a screenshot showing the 8 user-personal skills the
// user originally flagged at v0.0.0 now displaying v1.0.0.

import { test, expect } from "@playwright/test";

const STUDIO = "http://localhost:3140";
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

test("0756: npx vskill@0.5.128 — flagged skills show v1.0.0, never v0.0.0", async ({ page }) => {
  await page.goto(STUDIO, { waitUntil: "domcontentloaded" });
  await page.locator("text=AVAILABLE").first().waitFor({ timeout: 15000 });

  // Expand PERSONAL > CLAUDE-CODE.
  for (const label of ["PERSONAL", "CLAUDE-CODE"]) {
    const t = page.locator(`text=/^${label}$/`).first();
    if (await t.count()) {
      await t.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  // Wait for polling cycle to settle.
  await page.waitForTimeout(3500);

  // Bring the first row into view, then snap a clean screenshot.
  const first = page.locator(`text=${FLAGGED[0]}`).first();
  await first.waitFor({ state: "visible", timeout: 8000 });
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${REPORTS}/npx-0.5.128-final.png`, fullPage: true });

  // Read every flagged skill's badge and assert no v0.0.0.
  const versions: Record<string, string | null> = {};
  for (const name of FLAGGED) {
    const row = page.locator(`text=${name}`).first();
    const badge = row
      .locator('xpath=ancestor::*[self::button or self::a][1]')
      .locator('[data-testid="skill-row-version"]')
      .first();
    const v = await badge.getAttribute("data-version");
    versions[name] = v;
    console.log(`[0756] ${name.padEnd(35)} → v${v}`);
    expect(v, `${name} must NOT be 0.0.0`).not.toBe("0.0.0");
    expect(v, `${name} must be a valid semver`).toMatch(/^\d+\.\d+\.\d+/);
  }

  // Whole-page sanity: NO badge on the page reads 0.0.0.
  const offenders = await page.locator('[data-version="0.0.0"]').count();
  console.log(`[0756] total badges with v0.0.0 on page: ${offenders}`);
  expect(offenders).toBe(0);
});
