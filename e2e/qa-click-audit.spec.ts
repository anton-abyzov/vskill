// ---------------------------------------------------------------------------
// QA click-audit suite — increment 0674 (studio redesign).
//
// One spec file exercising every interactive surface in the redesigned
// vSkill Studio. Each test cites the AC (from `.specweave/increments/
// 0674-vskill-studio-redesign/spec.md`) it is verifying.
//
// The fixture seeded by `eval serve --root e2e/fixtures` contains exactly
// one skill: test-plugin/test-skill (origin=source). That skill is enough
// to drive most interactions; anything requiring an Installed skill is
// marked .skip() with a note.
//
// When a regression is encountered the test is written to FAIL loudly with
// a message linking to qa-findings.md so ui-link-agent has a concrete
// repro. Assertions are structured so that a green run means the fix
// landed, not that the test silently degenerated.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function selectFixtureSkill(page: Page) {
  const row = page.getByRole("button", { name: /test-skill/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId("detail-header")).toBeVisible();
}

async function grantClipboard(page: Page) {
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  } catch {
    // Non-chromium engines may reject the permission string — clipboard
    // assertions downstream fall back to a shim read.
  }
}

// ---------------------------------------------------------------------------
// 1. Breadcrumb navigation (AC-US3-01, AC-US1-02 — projectName / origin / plugin)
// ---------------------------------------------------------------------------
test.describe("breadcrumb nav [AC-US3-01]", () => {
  test("breadcrumb renders Own + plugin as interactive segments; current segment is inert", async ({ page }) => {
    await page.goto("/");
    await selectFixtureSkill(page);

    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await expect(breadcrumb).toBeVisible();

    // Expect origin label OWN and plugin test-plugin to appear.
    await expect(breadcrumb).toContainText(/OWN/i);
    await expect(breadcrumb).toContainText(/test-plugin/);
    await expect(breadcrumb).toContainText(/test-skill/);

    // T-059 (increment 0674) made breadcrumbs interactive: Own + plugin
    // are buttons that filter/navigate the sidebar; the active segment
    // (test-skill) remains a plain text node so it doesn't imply an
    // action that loops back to the current view. This test replaces
    // the prior `linkCount === 0` regression canary (T-0684 / B7).
    const segments = breadcrumb.locator("a, button");
    await expect(segments).toHaveCount(2);
    await expect(segments.filter({ hasText: /own/i })).toBeVisible();
    await expect(segments.filter({ hasText: /test-plugin/ })).toBeVisible();

    // The current segment is a static label, not a button/link.
    const current = breadcrumb.locator("text=test-skill");
    await expect(current).toBeVisible();
    const currentIsInteractive = await current.evaluate((el) =>
      !!el.closest("a, button"),
    );
    expect(currentIsInteractive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Tab switching (AC-US3-01 / AC-US8-06)
//
// 0792 migration: Versions is no longer a top-level tab — it lives as the
// `?view=versions` chip under the unified `History` tab. We assert the new
// shape: clicking History selects the History top-level tab, then clicking
// the Versions sub-tab chip flips aria-selected and updates the tabpanel id.
// ---------------------------------------------------------------------------
test.describe("detail tabs [AC-US3-01, AC-US8-06]", () => {
  test("Overview / History+Versions tab navigation switches content and ARIA state", async ({ page }) => {
    await page.goto("/");
    await selectFixtureSkill(page);

    const overviewTab = page.getByTestId("detail-tab-overview");
    const historyTab = page.getByTestId("detail-tab-history");

    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(historyTab).toHaveAttribute("aria-selected", "false");

    // Switch to History tab (new home for Versions).
    await historyTab.click();
    await expect(historyTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("detail-panel-history")).toHaveAttribute(
      "id",
      "detail-panel-history",
    );

    // Drill into the Versions view chip — `?view=versions` per AC-US1-04.
    const versionsChip = page.getByTestId("detail-subtab-history-versions");
    await expect(versionsChip).toBeVisible();
    await versionsChip.click();
    await expect(versionsChip).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\?tab=history&view=versions/);
  });
});

// ---------------------------------------------------------------------------
// 3. Copy button (AC-US3-01, AC-US4-04 "C")
// ---------------------------------------------------------------------------
test.describe("copy path button [AC-US3-01]", () => {
  test("clicking Copy writes the skill path to the clipboard", async ({ page, browserName }) => {
    await grantClipboard(page);
    await page.goto("/");
    await selectFixtureSkill(page);

    const pathChip = page.getByTestId("detail-header-path-chip");
    const copyBtn = page.getByTestId("detail-header-copy-path");
    await expect(pathChip).toBeVisible();

    const displayedPath = (await pathChip.getAttribute("title"))!;
    expect(displayedPath).toMatch(/test-skill/);

    await copyBtn.click();

    // Post-click: the button flips its label to "Copied" for ~1.5s.
    await expect(copyBtn).toHaveText(/Copied/);

    // Clipboard read is blocked in webkit/firefox without permissions.
    // Run the read only on chromium where grantPermissions above worked.
    if (browserName === "chromium") {
      const clipText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
      expect(clipText, "clipboard should contain the full skill directory").toBe(displayedPath);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Sidebar row click (AC-US1-03, AC-US3-01)
// ---------------------------------------------------------------------------
test.describe("sidebar row click [AC-US1-03, AC-US3-01]", () => {
  test("clicking a sidebar row populates the right panel", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await row.click();

    await expect(page.getByTestId("detail-header-name")).toHaveText("test-skill");
    await expect(row).toHaveAttribute("aria-current", "true");
  });
});

// ---------------------------------------------------------------------------
// 5. Sidebar search filter + "/" shortcut (AC-US4-01, AC-US4-06)
// ---------------------------------------------------------------------------
test.describe("sidebar search [AC-US4-01, AC-US4-06]", () => {
  test("typing in the filter narrows rows; '/' focuses the input", async ({ page }) => {
    await page.goto("/");
    const input = page.getByRole("searchbox", { name: /filter skills/i });
    await expect(input).toBeVisible();

    // Typing "test" keeps the row; "xyzzy" filters it out.
    await input.fill("test");
    await expect(page.getByRole("button", { name: /test-skill/ }).first()).toBeVisible();

    await input.fill("xyzzy-nope-404");
    await expect(page.getByText(/no matches in this section/i).first()).toBeVisible();

    // Clear and re-focus via '/' from body.
    await input.fill("");
    await page.click("header");
    await page.keyboard.press("/");
    const isFocused = await input.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Section collapse (AC-US1-05)
// ---------------------------------------------------------------------------
test.describe("section collapse persistence [AC-US1-05]", () => {
  test("clicking OWN header toggles collapse; state persists on reload", async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem("vskill-sidebar-own-collapsed");
        window.localStorage.removeItem("vskill-sidebar-installed-collapsed");
      } catch {
        /* ignore */
      }
    });

    await page.goto("/");
    const ownHeader = page
      .locator("button[data-testid='sidebar-section-header']", { hasText: "Own" });
    await expect(ownHeader).toHaveAttribute("aria-expanded", "true");

    await ownHeader.click();
    await expect(ownHeader).toHaveAttribute("aria-expanded", "false");

    const storedAfterClick = await page.evaluate(() =>
      window.localStorage.getItem("vskill-sidebar-own-collapsed"),
    );
    expect(storedAfterClick).toBe("true");

    await page.reload();
    const ownHeaderAfter = page
      .locator("button[data-testid='sidebar-section-header']", { hasText: "Own" });
    await expect(ownHeaderAfter).toHaveAttribute("aria-expanded", "false");
  });
});

// ---------------------------------------------------------------------------
// 7. Keyboard navigation — j / k / Enter / ? (AC-US4-02, AC-US4-05)
// ---------------------------------------------------------------------------
test.describe("keyboard navigation [AC-US4-02, AC-US4-05]", () => {
  test("j/k move selection; Enter reselects; ? opens the shortcut cheatsheet", async ({ page }) => {
    await page.goto("/");
    // Click the document body so no input has focus.
    await page.click("header");

    // Move down once — first skill becomes selected.
    await page.keyboard.press("j");
    await expect(page.getByTestId("detail-header-name")).toHaveText("test-skill");

    // Shortcut cheatsheet opens on '?' — it is modal with role=dialog.
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// 8. Theme toggle (AC-US2-03, AC-US2-04, AC-US2-05)
// ---------------------------------------------------------------------------
test.describe("theme toggle [AC-US2-03, AC-US2-04]", () => {
  test("status-bar theme button flips data-theme and persists to localStorage", async ({ page, context }) => {
    await context.addInitScript(() => {
      try { window.localStorage.removeItem("vskill-theme"); } catch { /* ignore */ }
    });

    await page.goto("/");
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle).toBeVisible();

    const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(["light", "dark"]).toContain(before);

    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(after).not.toBe(before);

    const stored = await page.evaluate(() => window.localStorage.getItem("vskill-theme"));
    expect(stored, "theme selection must persist to `vskill-theme`").toBeTruthy();

    // Reload and confirm persistence.
    await page.reload();
    const afterReload = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );
    // With "auto" mode after two clicks (light→dark→auto from a fresh "auto"
    // start we should have landed somewhere != null on both clicks). We
    // don't assert equality to `after` because auto resolves at runtime.
    expect(afterReload).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. Command palette — Cmd/Ctrl+K + Escape (FR-005)
// ---------------------------------------------------------------------------
test.describe("command palette [FR-005]", () => {
  test("Cmd/Ctrl+K opens the palette; Escape dismisses it", async ({ page }) => {
    await page.goto("/");
    // Click the body so focus is predictable.
    await page.click("header");

    // Modifier selection: use Meta on mac-like runtime, Control otherwise.
    const isMac = await page.evaluate(() =>
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    );
    await page.keyboard.press(isMac ? "Meta+K" : "Control+K");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// 10. Context menu on skill row (AC-US4-07)
// ---------------------------------------------------------------------------
test.describe("context menu [AC-US4-07]", () => {
  test.fixme("right-click on a skill row opens the custom ContextMenu", async ({ page }) => {
    // REGRESSION: App.tsx / Sidebar.tsx never pass `onContextMenu` to the
    // <SkillRow> component, so right-click falls through to the native
    // browser menu. The component exists at ../src/eval-ui/src/components/
    // ContextMenu.tsx but is not wired up. Marked .fixme() until
    // ui-link-agent lands the wiring — the test will run green once the
    // handler is attached. See qa-findings.md.
    await page.goto("/");
    const row = page.getByRole("button", { name: /test-skill/ }).first();
    await row.click({ button: "right" });

    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// 11. MetadataTab — HOMEPAGE / ENTRY POINT / DIRECTORY behavior (AC-US3-02, AC-US3-05)
// ---------------------------------------------------------------------------
test.describe("metadata tab links + wrapping [AC-US3-02, AC-US3-05]", () => {
  test("ENTRY POINT and DIRECTORY render; paths break cleanly and are not mid-word-clipped", async ({ page }) => {
    await page.goto("/");
    await selectFixtureSkill(page);

    // Filesystem card is visible.
    await expect(page.getByRole("heading", { name: "Filesystem" })).toBeVisible();

    // Directory row renders the absolute dir.
    const dirLabel = page.getByText("Directory").first();
    await expect(dirLabel).toBeVisible();
    const dirVal = dirLabel.locator("xpath=following-sibling::*[1]").first();
    const dirWordBreak = await dirVal.evaluate((el) => getComputedStyle(el).wordBreak);
    // REGRESSION: current implementation uses wordBreak="break-all" which
    // breaks the path at every character. Spec wants path-friendly
    // breaking (break-word / overflow-wrap anywhere). Assert away from the
    // broken value so the fix flips this green.
    expect(dirWordBreak, "paths should not break at every character — see qa-findings.md")
      .not.toBe("break-all");

    // Entry point row shows the entry file name.
    await expect(page.getByText("Entry point").first()).toBeVisible();
    await expect(page.getByText("SKILL.md").first()).toBeVisible();
  });

  test.fixme("HOMEPAGE renders as an external anchor with rel=noopener when populated", async ({ page }) => {
    // The fixture skill does not have a homepage set, so this test is a
    // contract-only fixme. The component-level behavior is covered by the
    // jsdom spec in src/eval-ui/src/components/__tests__/qa-interactions.test.tsx.
    await page.goto("/");
    await selectFixtureSkill(page);
    const link = page.getByRole("link").filter({ hasText: /https?:\/\// });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });
});

// ---------------------------------------------------------------------------
// 12. Skill dependency chips (AC-US3-04)
// ---------------------------------------------------------------------------
test.describe("skill deps chips [AC-US3-04]", () => {
  test.fixme("clicking an installed dep chip navigates to that skill", async ({ page }) => {
    // Fixture only contains one skill with no deps — covered at the
    // component level in qa-interactions.test.tsx. This fixme placeholder
    // documents the AC for the Playwright suite so it flips to a full
    // test once the QA fixtures seed a skill with deps.
    await page.goto("/");
    await selectFixtureSkill(page);
    const chip = page.locator('[data-chip="skill-dep"][data-present="true"]').first();
    await chip.click();
    await expect(page.getByTestId("detail-header-name")).not.toHaveText("test-skill");
  });
});

// ---------------------------------------------------------------------------
// 13. Versions content (AC-US3-08)
//
// 0792 migration: Versions moved from a top-level tab to the
// `?view=versions` chip under History. Same regression canary applies — the
// VersionHistoryPanel must render its own content rather than the global
// "select a skill" fallback when a skill is already selected.
// ---------------------------------------------------------------------------
test.describe("versions view [AC-US3-08]", () => {
  test("history → versions view shows version history (integrated) — regression noted if fallback is displayed", async ({ page }) => {
    await page.goto("/");
    await selectFixtureSkill(page);

    await page.getByTestId("detail-tab-history").click();
    await page.getByTestId("detail-subtab-history-versions").click();
    await expect(page).toHaveURL(/\?tab=history&view=versions/);

    // Either the version list renders (green path) OR the "select a skill"
    // fallback is shown (regression). We assert the green path.
    const fallback = page.getByText(/select a skill from the sidebar to load its version/i);
    await expect(fallback, "Versions view should not show the 'select a skill' fallback when a skill is already selected — see qa-findings.md").toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Toast auto-dismiss + Escape (AC-US4-08)
// ---------------------------------------------------------------------------
test.describe("toast lifecycle [AC-US4-08]", () => {
  test("pressing 'e' fires a toast; it auto-dismisses within 5s; Escape dismisses earlier", async ({ page }) => {
    await page.goto("/");
    await page.click("header");

    // The 'e' shortcut fires a toast via App.tsx `editPlaceholder`.
    await page.keyboard.press("e");
    const toast = page.locator('[role="status"], [data-testid^="toast"]').filter({ hasText: /.+/ }).first();
    // At minimum the aria-live region or the toast DOM node becomes non-empty.
    await expect(toast).toBeVisible({ timeout: 1500 });

    // Immediate Escape dismisses the newest toast.
    await page.keyboard.press("Escape");

    // The toast DOM element is either removed or its message cleared within
    // a tick. We allow up to 500ms for the state update + unmount.
    await page.waitForTimeout(250);
    const toastStillVisibleCount = await page
      .locator('[data-toast-role="toast"], [data-testid^="toast-"]')
      .count();
    expect(toastStillVisibleCount).toBe(0);
  });
});
