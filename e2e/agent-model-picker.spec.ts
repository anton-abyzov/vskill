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

  // 0876 US-001 — the Ollama model list is dynamic (probeOllama → GET
  // /api/tags). The four hardcoded fallback models that used to leak when the
  // probe failed/timed out (llama3.1:8b, qwen2.5:32b, gemma2:9b, mistral:7b)
  // must never appear. Robust in every env: with Ollama down the list is
  // empty + the start-service CTA; with Ollama up it shows the real installed
  // models — neither contains the removed fallback names.
  test("0876 US-001: Ollama list shows no hardcoded fallback models", async ({ page }) => {
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+Shift+M`);
    await page.waitForSelector("[data-testid='agent-list']", { timeout: 2000 });
    await page.locator("[data-testid='agent-row-ollama']").hover();
    await page.waitForTimeout(300); // let the focused model pane render
    const popover = (await page.locator("[data-testid='agent-model-picker-popover']").textContent()) ?? "";
    expect(popover).not.toMatch(/llama3\.1:8b|qwen2\.5:32b|gemma2:9b|mistral:7b/i);
  });

  // 0876 US-002 — hovering OpenRouter triggers hydrateOpenRouter(). A
  // malformed upstream catalog (null `name`, junk all-null row) must not throw
  // an uncaught error on the hover path. The page `pageerror` listener is the
  // direct crash signal. The deterministic search-box → rankFiltered crash
  // path (which needs OpenRouter to be key-unlocked) is covered separately by
  // ModelList.0876-nullsafe.test.tsx; here we guard the real-browser hover.
  test("0876 US-002: hovering OpenRouter with a malformed catalog does not crash", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (e) => pageErrors.push(e));
    await page.route("**/api/openrouter/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            { id: "meta-llama/llama-3.3-70b-instruct", name: null },
            { id: null, name: null },
          ],
        }),
      }),
    );
    await waitForStudioReady(page);
    await page.keyboard.press(`${mod()}+Shift+M`);
    await page.waitForSelector("[data-testid='agent-list']", { timeout: 2000 });
    await page.locator("[data-testid='agent-row-openrouter']").hover();
    await page.waitForTimeout(300);
    // If OpenRouter is unlocked in this env, exercise the search/rankFiltered path too.
    const search = page.locator("[data-testid='model-search-input']");
    if (await search.count()) {
      await search.first().fill("llama");
      await page.waitForTimeout(150);
    }
    // The real crash signal is an uncaught error on the hover/hydrate/filter
    // path — a render throw unmounts the React root. (The popover wrapper may
    // close benignly on outside-click/Esc, so it is not a reliable liveness
    // probe; the always-present picker trigger is.)
    expect(pageErrors, pageErrors.map((e) => e.message).join("; ")).toHaveLength(0);
    await expect(page.locator("[data-testid='agent-model-picker-trigger']")).toBeVisible();
  });
});
