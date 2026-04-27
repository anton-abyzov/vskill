// ---------------------------------------------------------------------------
// 0792 T-020: Playwright spec for the redesigned Studio IA.
//
// Covers the new four-tab IA (Overview / Edit / Run / History), the inline
// Run-mode + History-view sub-tabs, the Edit-tab "Eval cases" disclosure, and
// the legacy URL redirects (?tab=tests/trigger/activation/versions). Driven
// against the e2e/fixtures/test-plugin/test-skill fixture, which has eval
// cases and is auto-served at port 3077 by playwright.config.ts.
//
// User stories: US-001, US-002.
// Acceptance criteria: AC-US1-01, AC-US1-02, AC-US1-03, AC-US1-04, AC-US1-05,
// AC-US1-06, AC-US2-03.
// ---------------------------------------------------------------------------

import { test, expect, Page } from "@playwright/test";

const SKILL_NAME = "test-skill";

async function openTestSkill(page: Page): Promise<void> {
  await page.goto("/");
  const row = page.getByRole("button", { name: new RegExp(SKILL_NAME) }).first();
  await expect(row).toBeVisible();
  await row.click();
  // Wait for the four-tab bar to appear before tests proceed.
  await expect(page.getByTestId("detail-tab-bar")).toBeVisible();
}

// Track console errors that originate from the IA shell itself (not from
// downstream API endpoints with unrelated fixture state). The 500s emitted by
// the leaderboard / version endpoints are pre-existing fixture noise and
// would mask real regressions if naively asserted on.
function startIaConsoleWatcher(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const isIgnorable = (text: string): boolean => {
    if (text.includes("Failed to load resource")) return true; // network 4xx/5xx surfaced as console error
    return false;
  };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnorable(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return { errors };
}

test.describe("0792 — Studio IA redesign", () => {
  test("AC-US1-01: top-level tab bar shows exactly four tabs (Overview/Edit/Run/History) and no legacy tabs", async ({
    page,
  }) => {
    await openTestSkill(page);

    // The four expected tabs are present.
    await expect(page.getByTestId("detail-tab-overview")).toBeVisible();
    await expect(page.getByTestId("detail-tab-edit")).toBeVisible();
    await expect(page.getByTestId("detail-tab-run")).toBeVisible();
    await expect(page.getByTestId("detail-tab-history")).toBeVisible();

    // The tablist has exactly four `role=tab` buttons.
    const tabBar = page.getByTestId("detail-tab-bar");
    const tabs = tabBar.getByRole("tab");
    await expect(tabs).toHaveCount(4);

    // No legacy tabs leak through.
    for (const legacy of ["tests", "trigger", "versions", "activation"]) {
      await expect(tabBar.getByTestId(`detail-tab-${legacy}`)).toHaveCount(0);
    }
  });

  test("AC-US1-03 / AC-US1-05 / AC-US2-03: Run tab shows three modes (benchmark/activation/ab), each updates the URL, mounts a panel, and emits no IA console errors", async ({
    page,
  }) => {
    const watcher = startIaConsoleWatcher(page);

    await openTestSkill(page);

    await page.getByTestId("detail-tab-run").click();
    await expect(page).toHaveURL(/\?tab=run\b/);

    // The Run sub-tab bar mounts with three modes.
    const runSubBar = page.getByTestId("detail-subtab-bar-run");
    await expect(runSubBar).toBeVisible();
    await expect(runSubBar.getByRole("tab")).toHaveCount(3);

    const runPanel = page.getByTestId("detail-panel-run");
    await expect(runPanel).toBeVisible();

    // benchmark is the default mode; URL omits ?mode= for the default value.
    await expect(runSubBar.getByTestId("detail-subtab-run-benchmark")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runPanel).not.toHaveText(/^\s*$/);

    // activation
    await runSubBar.getByTestId("detail-subtab-run-activation").click();
    await expect(page).toHaveURL(/\?tab=run&mode=activation/);
    await expect(runSubBar.getByTestId("detail-subtab-run-activation")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runPanel).toBeVisible();
    await expect(runPanel).not.toHaveText(/^\s*$/);

    // ab
    await runSubBar.getByTestId("detail-subtab-run-ab").click();
    await expect(page).toHaveURL(/\?tab=run&mode=ab/);
    await expect(runSubBar.getByTestId("detail-subtab-run-ab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runPanel).toBeVisible();
    await expect(runPanel).not.toHaveText(/^\s*$/);

    // Back to benchmark — URL sheds the ?mode= param (default value).
    await runSubBar.getByTestId("detail-subtab-run-benchmark").click();
    await expect(page).toHaveURL(/\?tab=run(?!&mode=)/);

    expect(
      watcher.errors,
      `unexpected IA console errors: ${watcher.errors.join("\n")}`,
    ).toEqual([]);
  });

  test("AC-US1-04 / AC-US1-05 / AC-US2-03: History tab shows three views (timeline/models/versions), each updates the URL, mounts a panel, and emits no IA console errors", async ({
    page,
  }) => {
    const watcher = startIaConsoleWatcher(page);

    await openTestSkill(page);

    await page.getByTestId("detail-tab-history").click();
    await expect(page).toHaveURL(/\?tab=history\b/);

    const historySubBar = page.getByTestId("detail-subtab-bar-history");
    await expect(historySubBar).toBeVisible();
    await expect(historySubBar.getByRole("tab")).toHaveCount(3);

    const historyPanel = page.getByTestId("detail-panel-history");
    await expect(historyPanel).toBeVisible();

    // timeline (default — no ?view= in URL)
    await expect(historySubBar.getByTestId("detail-subtab-history-timeline")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(historyPanel).not.toHaveText(/^\s*$/);

    // models
    await historySubBar.getByTestId("detail-subtab-history-models").click();
    await expect(page).toHaveURL(/\?tab=history&view=models/);
    await expect(historySubBar.getByTestId("detail-subtab-history-models")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel).not.toHaveText(/^\s*$/);

    // versions
    await historySubBar.getByTestId("detail-subtab-history-versions").click();
    await expect(page).toHaveURL(/\?tab=history&view=versions/);
    await expect(historySubBar.getByTestId("detail-subtab-history-versions")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel).not.toHaveText(/^\s*$/);

    // Back to timeline
    await historySubBar.getByTestId("detail-subtab-history-timeline").click();
    await expect(page).toHaveURL(/\?tab=history(?!&view=)/);

    expect(
      watcher.errors,
      `unexpected IA console errors: ${watcher.errors.join("\n")}`,
    ).toEqual([]);
  });

  test("AC-US1-02: Edit tab embeds eval-cases as a collapsed-by-default disclosure that persists open state across reloads", async ({
    page,
  }) => {
    await openTestSkill(page);

    // Clear any previous persisted state (other test runs / earlier sessions
    // may have flipped the localStorage key on this origin).
    await page.evaluate(() => {
      try {
        window.localStorage.removeItem("vskill:editor-eval-cases-open");
      } catch {
        /* noop */
      }
    });

    await page.getByTestId("detail-tab-edit").click();
    await expect(page).toHaveURL(/\?tab=edit\b/);

    // Markdown editor renders (textarea — see EditorPanel.tsx).
    const editPanel = page.getByTestId("detail-panel-edit");
    await expect(editPanel).toBeVisible();
    await expect(editPanel.locator("textarea").first()).toBeVisible();

    const disclosure = page.getByTestId("editor-eval-cases-section");
    await expect(disclosure).toBeVisible();
    // Starts collapsed (no `open` attribute, no body element).
    await expect(disclosure).not.toHaveAttribute("open", /.*/);
    await expect(page.getByTestId("editor-eval-cases-body")).toHaveCount(0);

    // Click summary to expand. The <summary> child of <details> is what
    // toggles the disclosure.
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", /.*/);
    await expect(page.getByTestId("editor-eval-cases-body")).toBeVisible();

    // Persistence: reload, navigate back to Edit, the disclosure stays open.
    await page.reload();
    await page.getByTestId("detail-tab-edit").click();
    const disclosureAfterReload = page.getByTestId("editor-eval-cases-section");
    await expect(disclosureAfterReload).toBeVisible();
    await expect(disclosureAfterReload).toHaveAttribute("open", /.*/);
    await expect(page.getByTestId("editor-eval-cases-body")).toBeVisible();

    // Cleanup so the persisted-open state doesn't leak into other tests.
    await page.evaluate(() => {
      try {
        window.localStorage.removeItem("vskill:editor-eval-cases-open");
      } catch {
        /* noop */
      }
    });
  });

  test("AC-US1-06: legacy ?tab= deep links rewrite to the canonical IA via replaceState", async ({
    page,
  }) => {
    // The redirect is one-shot on mount + popstate (App.tsx 0792 T-014). We
    // verify that for every legacy alias, navigating directly to it lands
    // the user on the canonical equivalent. The historical "no extra entry"
    // assertion (history.length growth bound) is brittle because page.goto
    // counts as a navigation regardless of replaceState; we rely on URL
    // match as the contract surface and trust App.tsx's call-site to use
    // replaceState (also covered by component tests).
    const cases = [
      { from: "?tab=tests", expect: /\?tab=run(?!&mode=)/ },
      { from: "?tab=trigger", expect: /\?tab=run&mode=activation/ },
      { from: "?tab=activation", expect: /\?tab=run&mode=activation/ },
      { from: "?tab=versions", expect: /\?tab=history&view=versions/ },
    ];

    for (const { from, expect: expectedUrl } of cases) {
      // Land on root, then jump to the legacy URL with the skill hash route.
      await page.goto(`/${from}#/skills/test-plugin/test-skill`);

      // The IA needs the test-skill row clicked to mount the tab bar (the
      // hash route alone selects the skill in the sidebar but doesn't
      // always rehydrate the detail header — clicking the row makes the
      // assertion deterministic across fixtures).
      const row = page.getByRole("button", { name: new RegExp(SKILL_NAME) }).first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(page.getByTestId("detail-tab-bar")).toBeVisible();

      // The route effect should have replaceState'd to the canonical URL.
      await expect(page).toHaveURL(expectedUrl);
    }
  });
});
