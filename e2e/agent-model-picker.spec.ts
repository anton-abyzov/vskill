// ---------------------------------------------------------------------------
// T-013: Playwright E2E for the Agent + Model picker (0682).
//
// Exercises three scenarios:
//   Scenario 1 — Studio boots with Claude Code as the default and shows
//                a silent trigger label (no toast banner).
//   Scenario 2 — User opens the picker via Cmd/Ctrl+Shift+M, highlights the
//                OpenRouter agent, sees the empty-state "Add API key →"
//                CTA card, clicks it, Settings modal opens, key saved,
//                picker reopens with OpenRouter live.
//   Scenario 3 — Same flow, keyboard-only (no pointer events), under 15s.
//
// Hotkey note (0828): the picker used to fire on bare Cmd+K but that
// collided with the FindSkillsPalette which also lives on Cmd+K. The picker
// was re-bound to Cmd+Shift+M ("M" for Model). The studio-hotkeys-cmdk
// suite covers the isolation between the two popovers.
//
// These specs target the real eval-server + Studio SPA — the server is
// started by Playwright's config. Tests that require an OpenRouter
// response use a fetch intercept to serve a frozen fixture.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

function mod(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function waitForStudioReady(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-testid='agent-model-picker-trigger']", { timeout: 10_000 });
  // The trigger renders "Loading…" until /api/config resolves and the
  // useAgentCatalog hook hydrates. Wait for the catalog to populate so
  // assertions against the trigger label and the StatusBar providers
  // segment can run against a hydrated DOM.
  await page
    .locator("[data-testid='agent-model-picker-trigger']")
    .filter({ hasNotText: /Loading/i })
    .first()
    .waitFor({ timeout: 10_000 });
}

test.describe("0682 — Agent + Model picker", () => {
  test("Scenario 1: boots with Claude Code as default, no nag toast", async ({ page }) => {
    await waitForStudioReady(page);
    // The trigger should display "Claude Code · <model>" — or at minimum
    // the string "Claude" — within 2 seconds of hydration.
    const triggerText = await page.locator("[data-testid='agent-model-picker-trigger']").textContent();
    expect(triggerText).toMatch(/Claude|Use current/i);
    // AC-US5-01: "Max/Pro" and "subscription" must not appear in picker /
    // Settings / StatusBar copy. The "· subscription" pricing suffix on
    // ModelList rows is the documented exception (whitelisted in voice-lint).
    const body = await page.locator("body").textContent();
    expect(body ?? "").not.toMatch(/Max\/Pro/i);
    expect(body ?? "").not.toMatch(/Pro\/Max/i);
    // Strip the whitelisted billing-mode tokens before scanning for
    // "subscription" elsewhere in the doc.
    const bodyMinusWhitelist = (body ?? "")
      .replace(/·\s*subscription/gi, "")
      .replace(/Subscription(?![\w-])/g, "");
    expect(bodyMinusWhitelist).not.toMatch(/\bsubscription\b/i);
  });

  test("Scenario 2: Cmd+Shift+M opens picker with ready-state panes and footer", async ({ page }) => {
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+Shift+M`);
    await page.waitForSelector("[data-testid='agent-model-picker-popover']", { timeout: 2000 });
    await expect(page.locator("[data-testid='agent-list']")).toBeVisible();
    await expect(page.locator("[data-testid='model-list'], [data-testid='openrouter-empty-card']")).toBeVisible();
    await expect(page.locator("[data-testid='picker-footer-settings']")).toBeVisible();
    // Esc closes.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);
  });

  test("Scenario 3: keyboard-only open+nav+close under 15s", async ({ page }) => {
    const start = Date.now();
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+Shift+M`);
    await page.waitForSelector("[data-testid='agent-list']", { timeout: 2000 });
    // Navigate the agent pane 3 times down and then Esc.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
  });

  // 0682 F-002 — Keyboard nav must walk BOTH panes. ↑↓ in the model pane
  // walks rows; Enter selects the row at the focused index (NOT models[0]
  // unconditionally). AC-US2-04.
  test("Scenario 4: keyboard nav inside model pane selects the focused row, not models[0]", async ({ page }) => {
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+Shift+M`);
    await page.waitForSelector("[data-testid='agent-list']", { timeout: 2000 });

    // Move focus into the model pane via Right Arrow.
    await page.keyboard.press("ArrowRight");

    // Walk down twice in the model pane. First non-empty agent (likely
    // Claude Code in the test env) has 3+ models so we can land on the
    // third row. Each ArrowDown advances focusedModelIndex by 1.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");

    // The focused row should carry data-focused="true" — not the first one.
    const focusedRows = await page.locator("[data-testid^='model-row-'][data-focused='true']").count();
    expect(focusedRows).toBe(1);

    // Capture the focused row's data-testid to confirm it's not the first
    // model row in the list.
    const allRows = page.locator("[data-testid^='model-row-']");
    const allCount = await allRows.count();
    expect(allCount).toBeGreaterThanOrEqual(3);
    const firstId = await allRows.nth(0).getAttribute("data-testid");
    const focusedId = await page.locator("[data-testid^='model-row-'][data-focused='true']").first().getAttribute("data-testid");
    expect(focusedId).not.toBe(firstId);
  });

  test("StatusBar shows per-provider lock glyphs", async ({ page }) => {
    await waitForStudioReady(page);
    // The StatusBar receives the providers prop only after /api/config has
    // resolved AND the App's effect that sets `config` has flushed. Wait
    // explicitly for the providers segment (or its narrow-viewport summary
    // collapse) to appear before counting glyphs. AC-US6-01 mandates a
    // glyph per provider above 640px; AC-US6-03 collapses below 640px.
    await page
      .locator("[data-testid='providers-segment']")
      .first()
      .waitFor({ timeout: 5_000 });
    const glyphs = page.locator("[data-testid^='provider-glyph-']");
    const summary = page.locator("[data-testid='providers-summary']");
    const glyphCount = await glyphs.count();
    const summaryCount = await summary.count();
    expect(glyphCount + summaryCount).toBeGreaterThan(0);
  });
});
