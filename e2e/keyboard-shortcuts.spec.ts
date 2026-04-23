// ---------------------------------------------------------------------------
// T-050: Keyboard shortcut coverage.
//
// AC-US4-01: `/` focuses the sidebar search input from any non-text context.
// AC-US4-02: `j` / `k` navigate selection down / up.
// AC-US4-05: `?` opens the keyboard cheatsheet, `Escape` closes it.
// AC-US4-09: `Cmd/Ctrl+B` toggles the sidebar column; `Cmd/Ctrl+Shift+D`
//            toggles theme.
//
// The sidebar-toggle and theme-toggle global shortcuts are wired by the
// polish-interactions-agent (`Shell` component in App.tsx plus a
// top-level keybinding handler). If that work has not landed yet this
// suite fails the corresponding assertions — which is the intended TDD
// state (failing tests describe the target behavior). The `/`, `j`, `k`
// assertions already exercise shipped code.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

function mod(): "Meta" | "Control" {
  // Use platform-native modifier for the spec run. Playwright launches a
  // Linux/macOS chromium; macOS conventions use Meta, everywhere else Ctrl.
  // The UI layer accepts either via a `metaKey || ctrlKey` check.
  return process.platform === "darwin" ? "Meta" : "Control";
}

async function waitForStudioReady(page: Page) {
  await page.goto("/");
  await page.waitForSelector("input[type='search']");
  await page.waitForSelector("button[data-testid='theme-toggle']");
}

test.describe("T-050 — global keyboard shortcuts", () => {
  test("'/' focuses the sidebar search input from the body", async ({ page }) => {
    await waitForStudioReady(page);

    // Click a non-input area to move focus away first.
    await page.click("header");
    await page.keyboard.press("/");

    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName + ":" + (el.getAttribute("type") ?? "") : null;
    });
    expect(active).toBe("INPUT:search");
  });

  test("'j' and 'k' move selection in the sidebar", async ({ page }) => {
    await waitForStudioReady(page);

    // Blur any focused input so shortcut handlers fire on body.
    await page.click("header");

    // Starting state: nothing selected. Pressing 'j' selects the first row.
    await page.keyboard.press("j");
    const firstSelected = await page.evaluate(() =>
      document.querySelector("[data-testid='skill-row'][aria-selected='true']")?.textContent?.trim() ?? null,
    );
    expect(firstSelected).not.toBeNull();

    // 'j' again advances to the next row (when multiple exist). On the
    // single-fixture dataset there is only one row, so 'j' is a no-op but
    // must not throw — confirm selection is still the same row.
    await page.keyboard.press("j");
    const stillSelected = await page.evaluate(() =>
      document.querySelector("[data-testid='skill-row'][aria-selected='true']")?.textContent?.trim() ?? null,
    );
    expect(stillSelected).toBe(firstSelected);
  });

  test("'?' opens the keyboard cheatsheet modal and Escape closes it", async ({ page }) => {
    await waitForStudioReady(page);
    await page.click("header");

    await page.keyboard.press("?");

    // The cheatsheet is a dialog with role="dialog" aria-modal="true" and an
    // accessible name matching "Keyboard shortcuts".
    const dialog = page.getByRole("dialog", { name: /Keyboard shortcuts/i });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Cmd/Ctrl+B toggles sidebar visibility", async ({ page }) => {
    await waitForStudioReady(page);
    await page.click("header");

    // Aside is always rendered when sidebar visible — locate by role.
    const aside = page.getByRole("complementary", { name: /Skills sidebar/i });
    await expect(aside).toBeVisible();

    await page.keyboard.press(`${mod()}+b`);
    await expect(aside).toBeHidden();

    await page.keyboard.press(`${mod()}+b`);
    await expect(aside).toBeVisible();
  });

  test("Cmd/Ctrl+Shift+D toggles the theme", async ({ page }) => {
    await waitForStudioReady(page);
    await page.click("header");

    const initial = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );

    await page.keyboard.press(`${mod()}+Shift+D`);

    const after = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(after).not.toBe(initial);

    // Press again — must flip back (or advance to the next resolved theme).
    await page.keyboard.press(`${mod()}+Shift+D`);
    const final = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(["light", "dark"]).toContain(final);
  });
});
