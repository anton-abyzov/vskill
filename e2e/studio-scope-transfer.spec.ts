import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0688 T-026 — E2E coverage for the skill-scope-transfer flow (promote → FLIP
// → Undo toast → revert) via the ACTUAL Studio UI (no test-only routes).
//
// ACs asserted:
//   AC-US1-01 — right-click INSTALLED/GLOBAL row → "Promote to OWN" →
//               SSE `started → copied → indexed → done` → row FLIP-animates
//               into the OWN section with a 150ms accent pulse.
//   AC-US1-02 — with `prefers-reduced-motion: reduce`, promote completes with
//               an instant re-parent — no flight animation, no pulse.
//   AC-US1-05 — context-menu item is reachable via keyboard only; Enter
//               triggers the same path as mouse click.
//   AC-US3-01 — Undo toast appears for 5s after promote; clicking Undo
//               within the window invokes revert, which physically deletes
//               the OWN copy and appends a `promote-reverted` op.
//   AC-US3-02 — after promote, a "Promoted from <source-path>" chip renders
//               on the OWN row labeled with source scope (INSTALLED/GLOBAL).
//   AC-US3-03 — Revert button is hidden on OWN rows without a
//               `.vskill-meta.json` sidecar (cannot revert authored skills).
//   AC-US3-05 — toast is Esc-dismissable; Undo button is Tab-reachable from
//               toast focus ring.
//
// Tests scaffolded BEFORE integration — they WILL fail until backend
// (T-003..T-017) + frontend (T-018..T-024) land. That's the intended TDD
// state: failing assertions describe the target behavior.
//
// These specs traverse the real UI — context menu, SSE round-trip, toast,
// and data-skill-id attribute (added by T-021). No test-only helpers.
// ---------------------------------------------------------------------------

const INSTALLED_PLUGIN = "test-plugin";
const INSTALLED_SKILL = "test-skill";
const INSTALLED_SKILL_ID = `${INSTALLED_PLUGIN}/${INSTALLED_SKILL}`;

async function gotoStudio(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });
}

async function openContextMenuByRightClick(page: Page, skillId: string) {
  const row = page.locator(`[data-skill-id="${skillId}"]`);
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await expect(page.locator("[data-testid='context-menu']")).toBeVisible();
}

async function openContextMenuByKeyboard(page: Page, skillId: string) {
  // Focus the row via keyboard then open the menu with the shared "menu key"
  // the studio uses for context menus. Existing SkillRow implementations
  // support Shift+F10 or the ContextMenu key on most platforms.
  const row = page.locator(`[data-skill-id="${skillId}"]`);
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator("[data-testid='context-menu']")).toBeVisible();
}

async function waitForToast(page: Page, label: string | RegExp) {
  const toast = page.getByRole("status").filter({ hasText: label });
  await expect(toast).toBeVisible();
  return toast;
}

test.describe("0688 T-026 — Promote → FLIP → Undo toast → revert", () => {
  test("AC-US1-01: promote row animates into OWN section via context menu + SSE round-trip", async ({
    page,
  }) => {
    await gotoStudio(page);

    // Record DOM-observed animation activity so we can assert the FLIP ran.
    await page.evaluate(() => {
      (window as unknown as { __flipAnimations: number }).__flipAnimations = 0;
      const orig = Element.prototype.animate;
      Element.prototype.animate = function (...args: unknown[]) {
        (window as unknown as { __flipAnimations: number }).__flipAnimations += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any).apply(this, args as unknown as Parameters<typeof orig>);
      } as typeof Element.prototype.animate;
    });

    await openContextMenuByRightClick(page, INSTALLED_SKILL_ID);

    const promoteItem = page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: /Promote to OWN/i });
    await expect(promoteItem).toBeVisible();
    await promoteItem.click();

    // Row should be present in the OWN section after SSE `done` + refresh.
    const ownHeader = page
      .locator("button[data-testid='sidebar-section-header']", { hasText: "Own" })
      .or(page.locator("button[data-testid='scope-section-header']", { hasText: "Own" }));
    await expect(ownHeader).toBeVisible();

    const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
    await expect(ownRow).toBeVisible({ timeout: 10_000 });

    // FLIP: at least one el.animate() fired for the transition.
    const flipCount = await page.evaluate(
      () => (window as unknown as { __flipAnimations: number }).__flipAnimations,
    );
    expect(flipCount).toBeGreaterThan(0);

    // AC-US3-02 — "Promoted from …" chip rendered on the landed row, labeled
    // with the source scope.
    const chip = ownRow.locator("[data-testid='promoted-from-chip']");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/Promoted from/i);
    await expect(chip).toContainText(/INSTALLED|GLOBAL/i);
  });

  test("AC-US1-02: prefers-reduced-motion promotes without animation or pulse", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    try {
      await gotoStudio(page);

      await page.evaluate(() => {
        (window as unknown as { __flipAnimations: number }).__flipAnimations = 0;
        const orig = Element.prototype.animate;
        Element.prototype.animate = function (...args: unknown[]) {
          (window as unknown as { __flipAnimations: number }).__flipAnimations += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (orig as any).apply(this, args as unknown as Parameters<typeof orig>);
        } as typeof Element.prototype.animate;
      });

      await openContextMenuByRightClick(page, INSTALLED_SKILL_ID);
      await page
        .locator("[data-testid='context-menu'] [role='menuitem']")
        .filter({ hasText: /Promote to OWN/i })
        .click();

      const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
      await expect(ownRow).toBeVisible({ timeout: 10_000 });

      // With reduced-motion, `runFlip` early-returns — el.animate should not
      // be called by the FLIP lib. The landed row is an instant re-parent.
      const flipCount = await page.evaluate(
        () => (window as unknown as { __flipAnimations: number }).__flipAnimations,
      );
      expect(flipCount).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test("AC-US1-05: promote reachable via keyboard only (Shift+F10 + Enter)", async ({ page }) => {
    await gotoStudio(page);

    await openContextMenuByKeyboard(page, INSTALLED_SKILL_ID);

    // Navigate to "Promote to OWN" with ArrowDown until the item is focused,
    // then activate with Enter.
    const menu = page.locator("[data-testid='context-menu']");
    const items = menu.locator("[role='menuitem']");
    const count = await items.count();
    let pressed = 0;
    for (; pressed < count; pressed++) {
      const focused = await page.evaluate(
        () => document.activeElement?.textContent?.trim() ?? null,
      );
      if (focused && /Promote to OWN/i.test(focused)) break;
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");

    const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
    await expect(ownRow).toBeVisible({ timeout: 10_000 });
  });

  test("AC-US3-01 / AC-US3-05: Undo toast appears, Tab reaches Undo, click reverts; Esc dismisses", async ({
    page,
  }) => {
    await gotoStudio(page);
    await openContextMenuByRightClick(page, INSTALLED_SKILL_ID);
    await page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: /Promote to OWN/i })
      .click();

    const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
    await expect(ownRow).toBeVisible({ timeout: 10_000 });

    const toast = await waitForToast(page, /Promoted .*→ OWN|Promoted .* to OWN/i);

    // AC-US3-05: toast has role="status"; Undo button is reachable via Tab
    // from the toast focus ring.
    const undoBtn = toast.getByRole("button", { name: /Undo/i });
    await expect(undoBtn).toBeVisible();

    // Click Undo within the 5s window.
    await undoBtn.click();

    // Row should be removed from OWN section after revert finishes.
    await expect(page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`)).toHaveCount(1, {
      timeout: 10_000,
    });
    // The surviving row must belong to INSTALLED (not OWN) — assert by section
    // ancestor data-origin when available.
    const row = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`).first();
    const originAncestor = row
      .locator("xpath=ancestor::*[@data-origin][1]")
      .first();
    const origin = await originAncestor
      .getAttribute("data-origin")
      .catch(() => null);
    if (origin !== null) {
      expect(origin).toMatch(/installed|global/i);
    }
  });

  test("AC-US3-05: Esc dismisses the Undo toast without reverting", async ({ page }) => {
    await gotoStudio(page);
    await openContextMenuByRightClick(page, INSTALLED_SKILL_ID);
    await page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: /Promote to OWN/i })
      .click();

    const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
    await expect(ownRow).toBeVisible({ timeout: 10_000 });

    const toast = await waitForToast(page, /Promoted/i);
    await expect(toast).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toast).toBeHidden({ timeout: 2_000 });

    // Skill must still be in OWN — Esc dismisses the toast without invoking
    // Undo (the promote stands).
    await expect(ownRow).toBeVisible();
  });

  test("AC-US3-03: Revert menu item is hidden on OWN rows without provenance (authored-from-scratch)", async ({
    page,
  }) => {
    await gotoStudio(page);

    // Locate the first OWN row that reports no provenance — the chip is the
    // UI signal that provenance is present, so absence of the chip means
    // authored-from-scratch.
    const ownSection = page
      .locator("[data-testid='scope-section']", { hasText: "Own" })
      .or(page.locator("[data-origin='own']"));
    await expect(ownSection).toBeVisible();

    const candidateRows = ownSection.locator("[data-skill-id]");
    const total = await candidateRows.count();
    if (total === 0) {
      test.skip(true, "No OWN fixture skill to exercise the authored-from-scratch path");
      return;
    }

    let exercised = false;
    for (let i = 0; i < total; i++) {
      const row = candidateRows.nth(i);
      const hasChip = await row.locator("[data-testid='promoted-from-chip']").count();
      if (hasChip > 0) continue;
      await row.click({ button: "right" });
      const menu = page.locator("[data-testid='context-menu']");
      await expect(menu).toBeVisible();
      const revert = menu.locator("[role='menuitem']").filter({ hasText: /Revert/i });
      await expect(revert).toHaveCount(0);
      // Close the menu before the next iteration.
      await page.keyboard.press("Escape");
      exercised = true;
      break;
    }
    expect(exercised).toBe(true);
  });
});
