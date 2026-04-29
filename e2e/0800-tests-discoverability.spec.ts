// ---------------------------------------------------------------------------
// 0800 E2E — Studio tests discoverability + read-only Run for installed skills.
//
// User stories: US-001, US-002.
// Acceptance criteria:
//   - AC-US1-01: Overview "N tests" chip → Run tab
//   - AC-US1-02 / AC-US1-03: Edit tab "Run all" CTA → ?tab=run&mode=benchmark&autorun=1
//   - AC-US1-04: autorun strips ?autorun=1 after dispatch
//   - AC-US2-01..04: installed skill shows Run buttons + banner, no Add/Edit/Delete
//   - AC-US2-07: installed Overview chip is rendered
//
// Driven against:
//   - source skill: e2e/fixtures/test-plugin/skills/test-skill (preferred)
//     OR easychamp/skills/tournament-manager (fallback — first source skill
//     surfaced by Studio)
//   - installed skill: e2e/fixtures/.claude/skills/installed-test (origin
//     classified as "installed" via classifyOrigin's `.claude/` prefix)
// ---------------------------------------------------------------------------

import { test, expect, Page } from "@playwright/test";

async function selectSkillByName(page: Page, name: string | RegExp): Promise<void> {
  await page.goto("/");
  const row = page.getByRole("button", { name }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId("detail-tab-bar")).toBeVisible();
}

test.describe("0800 — Studio tests discoverability", () => {
  test("AC-US1-01: Overview tab shows 'N tests' chip and click navigates to Run tab", async ({
    page,
  }) => {
    await selectSkillByName(page, /test-skill/);

    const chip = page.getByTestId("overview-tests-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/\d+\s*tests?/i);

    await chip.click();
    await expect(page).toHaveURL(/\?tab=run\b/);
  });

  test("AC-US1-02 / AC-US1-03 / AC-US1-04: Edit 'Run all' CTA deep-links to Run tab and autorun param strips after dispatch", async ({
    page,
  }) => {
    await selectSkillByName(page, /test-skill/);

    // Open Edit tab + expand the eval-cases section.
    await page.getByTestId("detail-tab-edit").click();
    await expect(page).toHaveURL(/\?tab=edit\b/);

    const disclosure = page.getByTestId("editor-eval-cases-section");
    await expect(disclosure).toBeVisible();
    if (!(await disclosure.evaluate((el: HTMLElement) => (el as HTMLDetailsElement).open))) {
      await disclosure.locator("summary").click();
    }

    // The Run all CTA is in the summary header.
    const runAll = page.getByTestId("editor-eval-cases-run-all");
    await expect(runAll).toBeVisible();

    // Capture benchmark dispatch — POST /api/skills/.../benchmark/case/N
    let benchmarkPosted = false;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/benchmark\/case\/\d+/.test(req.url())) {
        benchmarkPosted = true;
      }
    });

    await runAll.click();

    // URL transitions to the Run tab. Note: `mode=benchmark` is the default
    // sub-mode and the RightPanel URL effect strips defaults from the URL
    // (see RightPanel.tsx:445), so we don't assert on `mode=benchmark`
    // appearing in the final URL — only that the tab moved.
    await expect(page).toHaveURL(/\?.*\btab=run\b/);

    // Wait for the autorun query param to be removed (one-shot use).
    await expect.poll(
      () => new URL(page.url()).searchParams.has("autorun"),
      { timeout: 5_000 },
    ).toBe(false);

    // Benchmark dispatch fired at least once.
    await expect.poll(() => benchmarkPosted, { timeout: 10_000 }).toBe(true);
  });

  test("AC-US2-04 / AC-US2-03: installed skill shows read-only banner, no Add Test Case button", async ({
    page,
  }) => {
    await selectSkillByName(page, /installed-test/);

    // Installed skills hide the Edit tab in the IA — go straight to Run.
    await page.getByTestId("detail-tab-run").click();
    await expect(page).toHaveURL(/\?tab=run\b/);

    // Banner is rendered above the case list.
    await expect(page.getByTestId("tests-readonly-banner")).toBeVisible();
    await expect(page.getByTestId("tests-readonly-banner")).toHaveText(/read.?only/i);

    // No authoring affordances on installed skills.
    await expect(page.getByText("Add Test Case", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Create Test Case", { exact: true })).toHaveCount(0);
  });

  test("AC-US2-01: installed skill shows enabled 'Run All' button on Run tab", async ({
    page,
  }) => {
    await selectSkillByName(page, /installed-test/);

    await page.getByTestId("detail-tab-run").click();

    const runAll = page.getByRole("button", { name: /Run All/i }).first();
    await expect(runAll).toBeVisible();
    await expect(runAll).toBeEnabled();
  });

  test("AC-US2-07: installed Overview shows 'N tests' chip", async ({ page }) => {
    await selectSkillByName(page, /installed-test/);

    const chip = page.getByTestId("overview-tests-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/\d+\s*tests?/i);
  });
});
