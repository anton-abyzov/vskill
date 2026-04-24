// ---------------------------------------------------------------------------
// 0703 — Studio create-flow hotfix E2E verification.
//
// Six bugs shipped in the "+ New Skill → Generate with AI" flow. Each scenario
// below exercises one of the shipped fixes against the real eval-server SPA
// (webServer from playwright.config.ts serves e2e/fixtures at port 3077).
//
// SCOPE: verification only — the source fixes are already shipped and unit-
// tested. If a scenario fails here it's either a genuine regression or a
// test-setup mistake; the SPEC is fixed, not the source.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoStudio(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });
}

async function openCreateModal(page: Page) {
  const trigger = page.locator("[data-slot='create-skill-button']");
  await expect(trigger).toBeVisible();
  await trigger.click();
  // Modal step 1 header
  await expect(page.getByRole("heading", { name: "Create a skill" })).toBeVisible();
}

async function advanceToStep2(page: Page) {
  // The only "Continue →" button on step 1.
  await page.getByRole("button", { name: /Continue/ }).click();
  // Step 2 header
  await expect(page.getByRole("heading", { name: "Name and describe" })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Scenario 1 — Prompt pre-fills from modal (AC-US1-01 / US-US2-05)
// ---------------------------------------------------------------------------
test.describe("0703 — prompt pre-fill from modal", () => {
  test("typing description in modal seeds the Generate page textarea and enables the button", async ({
    page,
  }) => {
    await gotoStudio(page);
    await openCreateModal(page);
    await advanceToStep2(page);

    // Fill skill name + description on step 2
    const skillInput = page.locator("input[placeholder='my-new-skill']");
    await skillInput.fill("hotfix-demo-a");
    const descTextarea = page.locator("textarea[placeholder='Does a thing when Claude needs X']");
    await descTextarea.fill("Greets the user by name");

    // Click "Generate with AI" — should navigate to /#/create with params
    await page.getByRole("button", { name: /Generate with AI/ }).click();

    // Wait for the Create page to appear
    await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({
      timeout: 10_000,
    });

    // The prompt textarea on the AI-mode page has this placeholder:
    const promptTextarea = page.locator(
      "textarea[placeholder*='A skill that helps format SQL queries']",
    );
    await expect(promptTextarea).toBeVisible();
    await expect(promptTextarea).toHaveValue("Greets the user by name");

    // The Generate Skill button must NOT be disabled
    const genBtn = page.getByRole("button", { name: /Generate Skill/ });
    await expect(genBtn).toBeVisible();
    await expect(genBtn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Duplicate skill name blocked at modal (AC-US2-04)
// The fixture e2e/fixtures/skills/hotfix-dup-test/ is pre-seeded on disk.
// ---------------------------------------------------------------------------
test.describe("0703 — duplicate skill name pre-check", () => {
  test("modal shows 'already exists' error and does NOT navigate", async ({ page }) => {
    await gotoStudio(page);
    const initialHash = await page.evaluate(() => window.location.hash);

    await openCreateModal(page);
    await advanceToStep2(page);

    await page.locator("input[placeholder='my-new-skill']").fill("hotfix-dup-test");

    // Click Generate with AI — probe should return exists:true and keep us on the modal.
    await page.getByRole("button", { name: /Generate with AI/ }).click();

    // Wait for the error text to appear inline in the modal.
    const errorRegion = page.getByText(/already exists/i);
    await expect(errorRegion).toBeVisible({ timeout: 5_000 });

    // Hash must NOT have flipped to #/create.
    const hashAfter = await page.evaluate(() => window.location.hash);
    expect(hashAfter).not.toContain("/create");
    // (Should still be the home/same hash we started from.)
    expect(hashAfter === initialHash || hashAfter === "" || hashAfter === "#/").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Model picker no-overlap (AC-US3-01)
// ---------------------------------------------------------------------------
test.describe("0703 — ModelList row layout", () => {
  test("Claude Code pane rows are >= 44px tall and only ONE row shows 'routing to'", async ({
    page,
  }) => {
    await gotoStudio(page);

    // Open the agent-model picker via its trigger button.
    const trigger = page.locator("[data-testid='agent-model-picker-trigger']");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toBeVisible();

    // The ModelList pane is rendered only after an agent row is focused.
    // Hover the claude-cli (Claude Code) row to populate the ModelList.
    const claudeRow = page.locator(
      "[data-testid='agent-row-claude-cli'], [data-testid='agent-row-claude-code']",
    ).first();
    await expect(claudeRow).toBeVisible();
    await claudeRow.hover();

    // Wait for at least one model row to appear.
    await page
      .locator("button[data-testid^='model-row-']:not([data-testid$='-resolved'])")
      .first()
      .waitFor({ timeout: 5_000 });

    // Stricter selector: top-level rows end in the model id (no -resolved suffix).
    const topLevelRows = page.locator(
      "button[data-testid^='model-row-']:not([data-testid$='-resolved'])",
    );
    const rowCount = await topLevelRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(3); // opus / sonnet / haiku

    for (let i = 0; i < rowCount; i++) {
      const row = topLevelRows.nth(i);
      const box = await row.boundingBox();
      expect(box, `row ${i} has no bounding box`).not.toBeNull();
      expect(
        box!.height,
        `row ${i} height ${box!.height}px < 44`,
      ).toBeGreaterThanOrEqual(44);
    }

    // Exactly one row should carry the -resolved sub-line (the one whose alias
    // matches the server's resolvedModel). Eval-server defaults to "sonnet" so
    // the match lives on the sonnet row.
    const resolvedCount = await page.locator("[data-testid$='-resolved']").count();
    expect(resolvedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Direct /#/create navigation works (route regression guard)
// ---------------------------------------------------------------------------
test.describe("0703 — direct /#/create route", () => {
  test("navigating to /#/create?mode=standalone&…&description=… renders the page + seeds prompt", async ({
    page,
  }) => {
    await page.goto(
      "/#/create?mode=standalone&skillName=hotfix-route-test&description=Testing+route",
    );

    await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({
      timeout: 10_000,
    });

    const promptTextarea = page.locator(
      "textarea[placeholder*='A skill that helps format SQL queries']",
    );
    await expect(promptTextarea).toBeVisible();
    await expect(promptTextarea).toHaveValue("Testing route");
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Target Agents hidden under claude-code scope (AC-US4-01)
// ---------------------------------------------------------------------------
test.describe("0703 — Target Agents visibility gated on active scope", () => {
  test("under claude-code active scope, the Target Agents section is NOT rendered", async ({
    page,
  }) => {
    // Seed the localStorage BEFORE the SPA hydrates. We first navigate to the
    // root (same origin) so localStorage is scoped correctly, then set the
    // preference, then navigate to /#/create.
    await page.goto("/");
    await page.evaluate(() => {
      try {
        window.localStorage.setItem(
          "vskill.studio.prefs",
          JSON.stringify({ activeAgent: "claude-code" }),
        );
      } catch {
        // ignore
      }
    });

    await page.goto("/#/create?mode=standalone&skillName=hotfix-scope-test");
    await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({
      timeout: 10_000,
    });

    // The Target Agents section header must NOT appear.
    const pageText = (await page.locator("body").textContent()) ?? "";
    expect(pageText).not.toMatch(/Target Agents/);
  });
});
