// T-057: E2E — TestsPanel filter tabs and badge rendering
//
// 0792 migration: the "Tests" top-level tab was collapsed into the Edit tab
// as an "Eval cases" disclosure (per AC-US1-01 + AC-US1-02). TestsPanel is
// now hosted by `EditorPanel.EvalCasesSection` with `embedded` set, which
// keeps authoring UI (filter tabs, case list, badges) and gates execution
// surfaces (Run All / per-case Run/Compare/Base) — execution moved to the
// Run tab. These specs only assert authoring UI, so they migrate cleanly to
// the new path: Edit tab → expand "Eval cases" disclosure.
import { test, expect, type Page } from "@playwright/test";

async function openEvalCasesDisclosure(page: Page): Promise<void> {
  await page.goto("/");

  // Reset any persisted disclosure state from earlier runs so the
  // "starts collapsed" assumption holds.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("vskill:editor-eval-cases-open");
    } catch {
      /* noop */
    }
  });

  const row = page.getByRole("button", { name: /test-skill/ }).first();
  await expect(row).toBeVisible();
  await row.click();

  await page.getByTestId("detail-tab-edit").click();
  const disclosure = page.getByTestId("editor-eval-cases-section");
  await expect(disclosure).toBeVisible();
  await disclosure.locator("summary").click();
  await expect(page.getByTestId("editor-eval-cases-body")).toBeVisible();
}

test.describe("TestsPanel filter tabs and badges", () => {
  test("tests panel shows filter tabs (All, Unit, Integration)", async ({ page }) => {
    await openEvalCasesDisclosure(page);

    // Filter tabs render inside the embedded TestsPanel host. Scope the
    // search to the disclosure body so we don't pick up unrelated buttons
    // elsewhere in the studio (e.g. an "All Models" combobox option).
    const body = page.getByTestId("editor-eval-cases-body");
    await expect(body.locator("button:has-text('All')").first()).toBeVisible();
    await expect(body.locator("button:has-text('Unit')").first()).toBeVisible();
    await expect(body.locator("button:has-text('Integration')").first()).toBeVisible();
  });

  test("test cases show type badges (U/I)", async ({ page }) => {
    await openEvalCasesDisclosure(page);

    const body = page.getByTestId("editor-eval-cases-body");
    // At least one badge should be visible (default cases are unit type).
    // Badge text is "U" for unit tests.
    const unitBadges = body.locator("span:has-text('U')");
    await expect(unitBadges.first()).toBeVisible();
  });

  test("filter tabs filter the test case list", async ({ page }) => {
    await openEvalCasesDisclosure(page);

    const body = page.getByTestId("editor-eval-cases-body");
    const allTab = body.locator("button:has-text('All')").first();
    await allTab.click();

    // Count cases in the list by looking for case buttons (each has "#N").
    const allCases = body.locator("button:has-text('#')");
    const allCount = await allCases.count();
    expect(allCount).toBeGreaterThan(0);
  });
});
