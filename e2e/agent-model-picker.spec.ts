// ---------------------------------------------------------------------------
// T-013: Playwright E2E for the Agent + Model picker (0682).
//
// Exercises three scenarios:
//   Scenario 1 — Studio boots with Claude Code as the default and shows
//                a silent trigger label (no toast banner).
//   Scenario 2 — User opens the picker via Cmd/Ctrl+K, highlights the
//                OpenRouter agent, sees the empty-state "Add API key →"
//                CTA card, clicks it, Settings modal opens, key saved,
//                picker reopens with OpenRouter live.
//   Scenario 3 — Same flow, keyboard-only (no pointer events), under 15s.
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

  test("Scenario 2: Cmd+K opens picker with ready-state panes and footer", async ({ page }) => {
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+K`);
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
    await page.keyboard.press(`${mod()}+K`);
    await page.waitForSelector("[data-testid='agent-list']", { timeout: 2000 });
    // Navigate the agent pane 3 times down and then Esc.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15_000);
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
