// ---------------------------------------------------------------------------
// T-034: Detail panel populates on skill selection.
//
// Given the studio is running with a seeded skill that has a populated
// SKILL.md frontmatter, when the user clicks that skill in the sidebar, the
// detail panel surfaces:
//   - DetailHeader: skill name, plugin breadcrumb, origin dot badge, path chip
//   - Metadata tab: at least description and filesystem info
//   - aria-live "polite" region announces "Viewing <skill-name> (Own)"
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

test.describe("detail panel — T-034", () => {
  test("clicking a skill populates DetailHeader + Metadata tab", async ({ page }) => {
    await page.goto("/");

    // Wait for the sidebar to load the seeded fixture skill.
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await expect(row).toBeVisible();
    await row.click();

    // ----- DetailHeader assertions (T-026) ------------------------------
    const header = page.getByTestId("detail-header");
    await expect(header).toBeVisible();

    // Skill name + plugin breadcrumb
    await expect(page.getByTestId("detail-header-name")).toHaveText("test-skill");
    await expect(page.getByTestId("detail-header-plugin")).toHaveText("test-plugin");

    // Path chip + copy button
    await expect(page.getByTestId("detail-header-path-chip")).toBeVisible();
    await expect(page.getByTestId("detail-header-copy-path")).toBeVisible();

    // Origin dot badge — test fixture lives outside .claude/skills, so it
    // is classified as a source-origin "Own" skill.
    const originDot = page.locator('[data-origin-dot="source"]');
    await expect(originDot).toBeVisible();

    // ----- Metadata tab assertions (T-027) ------------------------------
    // Active tab should default to Overview with the Frontmatter card
    // showing the fixture's description.
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("heading", { name: "Frontmatter" })).toBeVisible();
    await expect(page.getByText(/Test skill for eval UI E2E tests/i)).toBeVisible();

    // Filesystem group shows at least the directory + last modified row.
    await expect(page.getByRole("heading", { name: "Filesystem" })).toBeVisible();
    await expect(page.getByText("Last modified")).toBeVisible();

    // ----- aria-live announcement (T-044 wiring on StudioLayout) --------
    // The live region lives at the StudioLayout root with role="status".
    // Its text content is "Viewing <skill> (Own)" after the click.
    const live = page.locator('[aria-live="polite"]').first();
    await expect(live).toHaveText(/Viewing\s+test-skill\s+\(Own\)/);
  });
});
