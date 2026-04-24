import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0688 T-027 — E2E coverage for the OpsDrawer surface (StatusBar ops-count
// chip → drawer open → virtualized newest-first list → SSE live-update →
// keyboard accessibility / focus trap / Esc-closes-and-returns-focus).
//
// ACs asserted:
//   AC-US4-02 — StatusBar renders an ops-count chip; clicking toggles the
//               OpsDrawer open/closed; Esc closes the drawer and returns
//               focus to the chip.
//   AC-US4-03 — OpsDrawer renders a virtualized newest-first list; each
//               row is expandable to show source/dest paths, timestamp,
//               and raw op JSON.
//   AC-US4-04 — OpsDrawer subscribes to `GET /api/studio/ops/stream` (SSE)
//               and live-prepends new op entries without polling / manual
//               refresh.
//   AC-US4-06 — Focus is trapped inside the drawer when open; Tab cycles
//               within the dialog; Esc closes and returns focus to chip.
//
// Also exercises AC-US1-02 sub-path by running the promote trigger under
// `reducedMotion: "reduce"` context and verifying no FLIP animation fires
// on the landed row — bridges into the same behaviour guarded by T-026.
//
// Tests scaffolded BEFORE integration — they WILL fail until T-014 (ops-log),
// T-016 (ops routes), T-020 (useStudioOps + OpsDrawer), and T-023
// (StatusBar+StudioLayout wiring) land. That's the intended TDD state.
// ---------------------------------------------------------------------------

const INSTALLED_PLUGIN = "test-plugin";
const INSTALLED_SKILL = "test-skill";
const INSTALLED_SKILL_ID = `${INSTALLED_PLUGIN}/${INSTALLED_SKILL}`;

async function gotoStudio(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });
}

async function promoteViaContextMenu(page: Page, skillId: string) {
  const row = page.locator(`[data-skill-id="${skillId}"]`);
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  await page
    .locator("[data-testid='context-menu'] [role='menuitem']")
    .filter({ hasText: /Promote to OWN/i })
    .click();
  // Wait for the SSE `done` side-effect — the row remains visible (same
  // data-skill-id, re-parented into OWN).
  await expect(page.locator(`[data-skill-id="${skillId}"]`)).toBeVisible({ timeout: 10_000 });
}

async function opsChip(page: Page) {
  return page.locator("[data-testid='ops-count-chip']");
}

async function opsDrawer(page: Page) {
  return page.locator("[data-testid='ops-drawer']");
}

test.describe("0688 T-027 — OpsDrawer live update + keyboard accessibility", () => {
  test("AC-US4-02: clicking OpsCountChip toggles drawer; aria-expanded updates", async ({
    page,
  }) => {
    await gotoStudio(page);

    const chip = await opsChip(page);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("role", "button");
    await expect(chip).toHaveAttribute("aria-expanded", "false");

    await chip.click();
    await expect(await opsDrawer(page)).toBeVisible();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(chip).toHaveAttribute("aria-controls", "ops-drawer");

    // Click again to toggle closed (spec says chip toggles open/closed).
    await chip.click();
    await expect(await opsDrawer(page)).toBeHidden();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  test("AC-US4-03: OpsDrawer renders a virtualized list with expandable rows", async ({
    page,
  }) => {
    await gotoStudio(page);

    // Seed the log with at least one op so the list isn't empty.
    await promoteViaContextMenu(page, INSTALLED_SKILL_ID);

    await (await opsChip(page)).click();
    const drawer = await opsDrawer(page);
    await expect(drawer).toBeVisible();

    // Virtuoso mounts a scroller region with role=list — match the virtuoso
    // viewport regardless of CSS-class churn.
    const viewport = drawer.locator("[data-testid='ops-virtuoso'], [data-virtuoso-scroller='true']");
    await expect(viewport.first()).toBeVisible();

    const rows = drawer.locator("[data-testid='ops-row']");
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();

    // Expand the first row and assert the detail block reveals source/dest
    // paths, timestamp, and raw JSON.
    await firstRow.click();
    const detail = firstRow.locator("[data-testid='ops-row-detail']");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/source|from/i);
    await expect(detail).toContainText(/dest|to/i);
    await expect(detail).toContainText(/\d{4}-\d{2}-\d{2}|ts|timestamp/i);
    // Raw JSON payload present somewhere in the detail block.
    const detailText = (await detail.textContent()) ?? "";
    expect(detailText).toContain("{");
    expect(detailText).toContain("}");
  });

  test("AC-US4-04: new op live-prepends via SSE while drawer is open (no refresh)", async ({
    page,
  }) => {
    await gotoStudio(page);

    // Seed one op so the drawer has a baseline.
    await promoteViaContextMenu(page, INSTALLED_SKILL_ID);

    await (await opsChip(page)).click();
    const drawer = await opsDrawer(page);
    await expect(drawer).toBeVisible();

    const initialCount = await drawer.locator("[data-testid='ops-row']").count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Trigger a second op — a revert on the now-OWN skill. Revert is
    // available because the prior promote wrote provenance.
    const ownRow = page.locator(`[data-skill-id="${INSTALLED_SKILL_ID}"]`);
    await ownRow.click({ button: "right" });
    await page
      .locator("[data-testid='context-menu'] [role='menuitem']")
      .filter({ hasText: /Revert/i })
      .click();

    // Drawer should gain a new row at the TOP without any page refresh or
    // chip re-click — SSE live-prepend.
    const rows = drawer.locator("[data-testid='ops-row']");
    await expect(rows).toHaveCount(initialCount + 1, { timeout: 10_000 });
    const topRowText = (await rows.first().textContent()) ?? "";
    expect(topRowText).toMatch(/revert/i);
  });

  test("AC-US4-06: focus trap — Tab cycles inside drawer; Esc closes + returns focus to chip", async ({
    page,
  }) => {
    await gotoStudio(page);
    await promoteViaContextMenu(page, INSTALLED_SKILL_ID);

    const chip = await opsChip(page);
    await chip.focus();
    await page.keyboard.press("Enter");
    const drawer = await opsDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");

    // Tab N times and confirm activeElement stays within the drawer.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const insideDrawer = await page.evaluate(() => {
        const d = document.querySelector("[data-testid='ops-drawer']");
        return d != null && d.contains(document.activeElement);
      });
      expect(insideDrawer).toBe(true);
    }

    // Esc closes the drawer and returns focus to the chip.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    const focusIsChip = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='ops-count-chip']");
      return el != null && el === document.activeElement;
    });
    expect(focusIsChip).toBe(true);
  });

  test("AC-US1-02 (cross-check): reducedMotion context produces no animation on the landed row", async ({
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

      await promoteViaContextMenu(page, INSTALLED_SKILL_ID);

      const flipCount = await page.evaluate(
        () => (window as unknown as { __flipAnimations: number }).__flipAnimations,
      );
      expect(flipCount).toBe(0);

      // Drawer open to confirm the op was still logged + visible.
      await (await opsChip(page)).click();
      await expect(await opsDrawer(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
