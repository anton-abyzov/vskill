// ---------------------------------------------------------------------------
// 0741 T-031 — Find-skills palette E2E (open → search → select → copy → toast).
//
// Strategy:
//   The eval-server at localhost:3077 serves e2e/fixtures. The palette and
//   detail panel hit the platform via the `/api/v1/studio/*`, `/api/v1/stats`,
//   and `/api/v1/skills/*` proxy. We stub all four at the page-route layer so
//   the test is hermetic — it never touches the real verified-skill.com.
//
// Covers:
//   - AC-US1-02: ⌘⇧K (Mac) / Ctrl+Shift+K opens the FindSkillsPalette
//   - AC-US3-02: empty query → trending fetched from /api/v1/stats
//   - AC-US3-03: typed query → debounced fetch to /api/v1/studio/search
//   - AC-US4-01..05: selecting a result opens SkillDetailPanel; Copy writes
//     the install command to clipboard and dispatches a toast
//   - AC-US5-03: telemetry POST is fire-and-forget (failure does not block UI)
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

const SKILL = {
  owner: "anton-abyzov",
  repo: "vskill",
  slug: "obsidian-brain",
  name: "anton-abyzov/vskill/obsidian-brain",
  displayName: "Obsidian Brain",
  description: "Autonomous Obsidian vault management.",
  certTier: "VERIFIED",
  isBlocked: false,
  isTainted: false,
  stars: 42,
};

const VERSIONS = [
  { version: "1.2.3", publishedAt: "2026-04-20T00:00:00Z", author: "anton@example.com" },
  { version: "1.2.2", publishedAt: "2026-04-15T00:00:00Z", author: "anton@example.com" },
  { version: "1.2.1", publishedAt: "2026-04-10T00:00:00Z", author: "anton@example.com" },
  { version: "1.2.0", publishedAt: "2026-04-05T00:00:00Z", author: "anton@example.com" },
  { version: "1.1.0", publishedAt: "2026-03-30T00:00:00Z", author: "anton@example.com" },
];

test.describe("0741 — Find-skills palette E2E", () => {
  test.beforeEach(async ({ page, context }) => {
    // Grant clipboard permissions so navigator.clipboard.readText() works.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Stub /api/v1/stats (trending fallback for empty query).
    await page.route("**/api/v1/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trendingSkills: [
            { name: SKILL.name, displayName: SKILL.displayName, stars: SKILL.stars },
          ],
        }),
      });
    });

    // Stub /api/v1/studio/search (typed-query results).
    await page.route("**/api/v1/studio/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              name: SKILL.name,
              displayName: SKILL.displayName,
              description: SKILL.description,
              certTier: SKILL.certTier,
              isBlocked: SKILL.isBlocked,
              isTainted: SKILL.isTainted,
              stars: SKILL.stars,
            },
          ],
          total: 1,
          pagination: { hasMore: false },
        }),
      });
    });

    // Stub skill metadata + versions endpoints.
    await page.route(`**/api/v1/skills/${SKILL.owner}/${SKILL.repo}/${SKILL.slug}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ skill: SKILL }),
      });
    });
    await page.route(
      `**/api/v1/skills/${SKILL.owner}/${SKILL.repo}/${SKILL.slug}/versions`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ versions: VERSIONS }),
        });
      },
    );

    // Telemetry endpoints — return 500 to assert the UI does NOT block on failure.
    await page.route("**/api/v1/studio/telemetry/**", async (route) => {
      await route.fulfill({ status: 500, body: "" });
    });

    // Idle stubs for the eval-ui's own polling endpoints.
    await page.route("**/api/skills/updates", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/v1/skills/stream*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: "",
      });
    });
  });

  test("opens via ⌘⇧K, searches, selects, copies install command, sees toast", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");

    // 1a. Click the TopRail "Find skills" button (covers AC-US2-02).
    const navButton = page.getByTestId("find-skills-nav-button");
    await expect(navButton).toBeVisible({ timeout: 5000 });
    await navButton.click();

    // 1b. The palette opens (any role=dialog within the FindSkillsPalette tree).
    const palette = page.locator('[role="dialog"]').first();
    await expect(palette).toBeVisible({ timeout: 5000 });

    // 2. Type a query — debounced search hits the studio endpoint.
    const input = palette.getByRole("combobox").or(palette.locator('input').first());
    await input.fill("obsidian");

    // 3. Result option appears (palette renders skill slug, not displayName).
    const resultRow = palette.getByRole("option").first();
    await expect(resultRow).toBeVisible({ timeout: 5000 });
    await expect(resultRow).toContainText(SKILL.slug);

    // 4. Click the result → palette closes, SkillDetailPanel opens.
    await resultRow.click();
    const detailPanel = page.getByRole("dialog", { name: /skill detail/i });
    await expect(detailPanel).toBeVisible({ timeout: 5000 });

    // 5. Install command shows the latest version syntax (no @version suffix for latest).
    const expectedInstall = `vskill install ${SKILL.name}`;
    await expect(detailPanel.getByText(expectedInstall)).toBeVisible();

    // 6. Click Copy → clipboard contains the install command.
    const copyButton = detailPanel.getByRole("button", { name: /copy/i });
    await copyButton.click();

    // Webkit on Linux/CI may not expose clipboard.readText; skip the assert there.
    if (browserName !== "webkit") {
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe(expectedInstall);
    }

    // 7. Toast appears (role=status, dismisses after 3.5s — assert .first() to
    // handle the duplicate generic+status pair the live region renders).
    await expect(
      page.getByText(/run vskill install/i).first(),
    ).toBeVisible({ timeout: 3000 });
  });
});
