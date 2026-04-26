// 0756 — Proof for the URL the user reported: /skills/claude-code/frontend-design
//
// frontend-design has frontmatter `version:` MISSING. Before this fix, the detail
// header and metadata tab read `skill.version ?? null` directly, so the platform's
// `/check-updates` echo of `installed: "0.0.0"` would override the brief 1.0.0
// flash. After this fix:
//   - VersionBadge rejects "0.0.0" defensively.
//   - DetailHeader, SkillOverview, MetadataTab, SkillRowHoverCard, HistoryPanel,
//     ActivationPanel all prefer `resolvedVersion` over raw `skill.version`.
//
// Captures every visible version surface for the same skill the user reported.

import { test, expect, type Page } from "@playwright/test";

const STUDIO = "http://localhost:3138";
const REPORTS =
  "/Users/antonabyzov/Projects/github/specweave-umb/.specweave/increments/0756-fix-zero-zero-zero-version-sentinel/reports";

test("0756: frontend-design detail page — no surface anywhere shows v0.0.0", async ({ page }) => {
  // Hit the same URL hash the user reported, just on our fixed-build port.
  await page.goto(`${STUDIO}/#/skills/claude-code/frontend-design`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("text=AVAILABLE").first().waitFor({ timeout: 15000 });

  // Wait long enough for the polling cycle + check-updates merge to land — the
  // user reported "1.0.0 flashes briefly then changes to 0.0.0", so we must
  // assert AFTER the merge runs, not before.
  await page.waitForTimeout(4000);

  await page.screenshot({ path: `${REPORTS}/detail-page-frontend-design-after.png`, fullPage: true });

  // 1. Detail header version badge.
  const detailHeader = page.locator('[data-testid="detail-header-version"]').first();
  if (await detailHeader.count()) {
    const badge = detailHeader.locator('[data-testid="version-badge"]').first();
    const v = await badge.getAttribute("data-version");
    console.log(`[0756] detail-header                   v${v}`);
    expect(v, `detail-header version must NOT be 0.0.0`).not.toBe("0.0.0");
  }

  // 2. Skill overview (Overview tab) version badge — same pattern.
  const overview = page.locator('[data-testid="skill-overview-name"]').first();
  if (await overview.count()) {
    const badge = overview
      .locator('xpath=ancestor::*[1]')
      .locator('[data-testid="version-badge"]')
      .first();
    if (await badge.count()) {
      const v = await badge.getAttribute("data-version");
      console.log(`[0756] skill-overview                   v${v}`);
      expect(v, `skill-overview version must NOT be 0.0.0`).not.toBe("0.0.0");
    }
  }

  // 3. Expand PERSONAL > CLAUDE-CODE so the sidebar rows render.
  for (const label of ["PERSONAL", "CLAUDE-CODE"]) {
    const target = page.locator(`text=/^${label}$/`).first();
    if (await target.count()) {
      await target.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  // 4. Sample badges across the whole page — none should read 0.0.0.
  const allBadges = await page
    .locator('[data-version]')
    .evaluateAll((els: Element[]) =>
      els.map((el) => ({
        version: el.getAttribute("data-version"),
        testid: el.getAttribute("data-testid"),
        text: (el.textContent || "").trim(),
      })),
    );
  console.log(`[0756] total version-bearing elements:  ${allBadges.length}`);
  const bad = allBadges.filter((b) => b.version === "0.0.0");
  if (bad.length) {
    console.log("[0756] OFFENDERS (version=0.0.0):");
    for (const b of bad) console.log(`         testid=${b.testid} text=${JSON.stringify(b.text)}`);
  }
  expect(bad.length, `no element on the page may render v0.0.0`).toBe(0);
});
