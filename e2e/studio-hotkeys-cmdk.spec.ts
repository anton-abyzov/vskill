// ---------------------------------------------------------------------------
// 0828 — Studio hotkey isolation: Cmd+K only opens FindSkillsPalette.
//
// Bug being prevented (regression test): two `keydown` listeners both fired on
// Cmd+K — the App-level shortcut hook (correct: opens FindSkillsPalette) and
// a duplicate handler inside AgentModelPicker (wrong: also opened the model
// picker popover). The picker hotkey was re-bound to Cmd+Shift+M ("M" for
// Model). This spec locks both behaviors in.
//
// Boot harness mirrors agent-model-picker.spec.ts and find-skills-palette.spec.ts:
// the eval-server is started by playwright.config.ts on port 3077 and serves
// the studio bundle at the default baseURL. Trending/search API calls are
// stubbed in beforeEach because the eval-server doesn't proxy them and the
// palette's fetch hangs would slow / destabilise the lazy-chunk warm-up step
// in `waitForStudioReady`.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

function mod(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function stubPaletteEndpoints(page: Page) {
  await page.route("**/api/v1/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trendingSkills: [] }),
    }),
  );
  await page.route("**/api/v1/studio/search**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [], total: 0, pagination: { hasMore: false } }),
    }),
  );
}

async function waitForStudioReady(page: Page) {
  await page.goto("/");
  // The agent+model picker trigger is one of the last things to hydrate
  // because it waits on /api/config — using its testid is a reliable
  // "studio is ready" gate, same as the picker spec.
  await page.waitForSelector("[data-testid='agent-model-picker-trigger']", { timeout: 10_000 });
  await page
    .locator("[data-testid='agent-model-picker-trigger']")
    .filter({ hasNotText: /Loading/i })
    .first()
    .waitFor({ timeout: 10_000 });
  // FindSkillsPalette is lazy-loaded — until its chunk resolves the shell's
  // `openFindSkills` listener isn't attached, so the very first Cmd+K press
  // can be dropped. Poll the CustomEvent until the palette mounts, then
  // close it. Keystrokes pressed after this point reliably reach a live
  // listener. Polling (rather than a single click) keeps us robust against
  // slow second-context chunk loads observed in this suite.
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("openFindSkills"));
      return !!document.querySelector("[data-testid='find-skills-palette']");
    },
    null,
    { timeout: 15_000, polling: 200 },
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid='find-skills-palette']", { state: "detached", timeout: 5_000 });
}

test.describe("0828 — Cmd+K opens ONLY the FindSkillsPalette", () => {
  test.beforeEach(async ({ page }) => {
    await stubPaletteEndpoints(page);
  });

  test("Cmd+K opens FindSkillsPalette and does NOT open the AgentModelPicker", async ({ page }) => {
    await waitForStudioReady(page);

    // Sanity: neither popover is visible at boot.
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);

    await page.keyboard.press(`${mod()}+K`);

    // FindSkillsPalette must be visible.
    await expect(page.locator("[data-testid='find-skills-palette']")).toBeVisible({ timeout: 3000 });

    // AgentModelPicker must NOT have opened on the same keystroke.
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);
  });

  test("Esc closes the FindSkillsPalette opened by Cmd+K", async ({ page }) => {
    await waitForStudioReady(page);

    await page.keyboard.press(`${mod()}+K`);
    await expect(page.locator("[data-testid='find-skills-palette']")).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);
  });

  test("Cmd+Shift+M opens AgentModelPicker and does NOT open FindSkillsPalette", async ({ page }) => {
    await waitForStudioReady(page);

    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);

    await page.keyboard.press(`${mod()}+Shift+M`);

    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);

    // The popover's Esc handler is registered in a useEffect that runs
    // after commit; a tiny wait gives React time to flush before Esc.
    await page.waitForTimeout(100);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);
  });

  test("rapid Cmd+K → Esc → Cmd+Shift+M → Esc cycle leaves no stale popover", async ({ page }) => {
    await waitForStudioReady(page);

    await page.keyboard.press(`${mod()}+K`);
    await expect(page.locator("[data-testid='find-skills-palette']")).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);

    await page.keyboard.press(`${mod()}+Shift+M`);
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toBeVisible({ timeout: 3000 });
    // Same commit-grace pattern as the previous test.
    await page.waitForTimeout(100);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);

    // Both gone, both reachable independently — the goal of the rebind.
    await expect(page.locator("[data-testid='find-skills-palette']")).toHaveCount(0);
    await expect(page.locator("[data-testid='agent-model-picker-popover']")).toHaveCount(0);
  });
});
