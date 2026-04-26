// 0756 — Verifies the studio sidebar no longer shows v0.0.0 anywhere.
// Run against a studio launched from the local dist on port 3138, rooted at TestLab.

import { test, expect, type Page } from "@playwright/test";

const STUDIO_URL = "http://localhost:3138";
const REPORTS =
  "/Users/antonabyzov/Projects/github/specweave-umb/.specweave/increments/0756-fix-zero-zero-zero-version-sentinel/reports";

const CODEX_SKILLS = ["codex-cli-runtime", "codex-result-handling", "gpt-5-4-prompting"];

// All the user-personal skills the user flagged with v0.0.0 in their screenshot.
const PERSONAL_SKILLS = [
  "excalidraw-diagram-generator",
  "excalidraw-skill",
  "frontend-design",
  "nanobanana",
  "pptx",
  "social-media-posting",
  "tax-filing",
  "webapp-testing",
];

async function settle(page: Page) {
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.locator('text=AVAILABLE').first().waitFor({ timeout: 15000 });
  // Allow the polling cycle + version-resolver effect to settle. The resolver
  // runs in normalizeSkillInfo on the initial /api/skills response and again
  // in mergeUpdatesIntoSkills after /api/v1/skills/check-updates returns.
  await page.waitForTimeout(3000);
}

async function expandSection(page: Page, label: string) {
  const target = page.locator(`text=/^${label}$/`).first();
  if (await target.count()) {
    await target.scrollIntoViewIfNeeded();
    await target.click({ force: true });
    await page.waitForTimeout(500);
  }
}

async function assertNoZeroVersion(page: Page, name: string) {
  const row = page.locator(`text=${name}`).first();
  await expect(row, `row "${name}" should be visible`).toBeVisible();
  const badge = row
    .locator('xpath=ancestor::*[self::button or self::a][1]')
    .locator('[data-testid="skill-row-version"]')
    .first();
  await expect(badge).toBeVisible();
  const dataVersion = await badge.getAttribute("data-version");
  expect(
    dataVersion,
    `skill "${name}" still shows v${dataVersion} (must NOT be 0.0.0)`,
  ).not.toBe("0.0.0");
  expect(dataVersion).toMatch(/^\d+\.\d+\.\d+/);
  console.log(`[0756] ${name.padEnd(35)} → v${dataVersion}`);
}

test("0756: codex plugin skills never show v0.0.0", async ({ page }) => {
  await settle(page);
  // Codex section starts collapsed; the chevron is sometimes intercepted on
  // first click. Try up to 3 times until a child row is visible.
  for (let attempt = 0; attempt < 3; attempt++) {
    await expandSection(page, "codex");
    if (await page.locator(`text=${CODEX_SKILLS[0]}`).count()) break;
    // Fallback: click the codex label's container ancestor.
    const label = page.locator('text=/^codex$/').first();
    if (await label.count()) {
      await label.locator('xpath=ancestor::*[1]').click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
  const firstCodex = page.locator(`text=${CODEX_SKILLS[0]}`).first();
  await firstCodex.waitFor({ state: "visible", timeout: 8000 });
  await firstCodex.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${REPORTS}/studio-after-fix-codex.png`, fullPage: true });
  for (const name of CODEX_SKILLS) await assertNoZeroVersion(page, name);
});

test("0756: PERSONAL > CLAUDE-CODE user skills never show v0.0.0", async ({ page }) => {
  await settle(page);
  // Expand PERSONAL group, then the CLAUDE-CODE subgroup inside it.
  await expandSection(page, "PERSONAL");
  await expandSection(page, "CLAUDE-CODE");
  // Scroll the first flagged skill into view before snapping.
  const first = page.locator(`text=${PERSONAL_SKILLS[0]}`).first();
  await first.waitFor({ state: "visible", timeout: 5000 });
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${REPORTS}/studio-after-fix-personal.png`, fullPage: true });
  for (const name of PERSONAL_SKILLS) await assertNoZeroVersion(page, name);
});
