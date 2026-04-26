// 0751 — Find-skills palette redesign verification.
//
// Locks the editorial-paper redesign and the slick UX behaviors:
//   - Search input is focused on the very first frame after the palette opens
//     (no setTimeout(50) delay perceptible to the user).
//   - Footer with keyboard hints (↑↓ navigate · ↵ open · ⌘ 1-9 jump) is
//     present and inside the palette card.
//   - Selected row carries the accent left rail + ⌘+digit jump hint.
//   - Card has a real warm-paper background (no transparent-card regression
//     where underlying page bleeds through — the bug from the 0741 baseline).
//   - When the upstream search endpoint returns 502 search_unavailable, the
//     palette degrades to client-side trending filtering with a soft banner
//     instead of the harsh red "search failed (502)" error.
//
// Hermetic: every upstream call is page.route()'d so we don't depend on
// verified-skill.com being reachable from CI.
import { test, expect } from "@playwright/test";

const TRENDING = [
  { name: "openclaw/openclaw/blucli",   displayName: "blucli",   author: "openclaw",      repoUrl: "https://github.com/openclaw/openclaw", certTier: "VERIFIED",  ownerSlug: "openclaw", repoSlug: "openclaw", skillSlug: "blucli" },
  { name: "openclaw/openclaw/gifgrep",  displayName: "gifgrep",  author: "openclaw",      repoUrl: "https://github.com/openclaw/openclaw", certTier: "VERIFIED",  ownerSlug: "openclaw", repoSlug: "openclaw", skillSlug: "gifgrep" },
  { name: "openclaw/openclaw/gog",      displayName: "gog",      author: "openclaw",      repoUrl: "https://github.com/openclaw/openclaw", certTier: "VERIFIED",  ownerSlug: "openclaw", repoSlug: "openclaw", skillSlug: "gog" },
  { name: "thedotmack/claude-mem/make-plan", displayName: "make-plan", author: "thedotmack", repoUrl: "https://github.com/thedotmack/claude-mem", certTier: "VERIFIED", ownerSlug: "thedotmack", repoSlug: "claude-mem", skillSlug: "make-plan" },
  { name: "google-gemini/gemini-cli/gemini-cli", displayName: "gemini-cli", author: "google-gemini", repoUrl: "https://github.com/google-gemini/gemini-cli", certTier: "CERTIFIED", ownerSlug: "google-gemini", repoSlug: "gemini-cli", skillSlug: "gemini-cli" },
];

test.describe("0751 — Find-skills palette redesign", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trendingSkills: TRENDING }),
      });
    });
    // Idle stubs for the polling endpoints so the test isn't noisy.
    await page.route("**/api/skills/updates", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.route("**/api/v1/skills/stream*", (route) => route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: "",
    }));
    await page.route("**/api/v1/studio/telemetry/**", (route) => route.fulfill({ status: 200, body: "" }));
  });

  test("focuses search input synchronously, no setTimeout delay", async ({ page }) => {
    // Block search so the test stays deterministic regardless of upstream.
    await page.route("**/api/v1/studio/search**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0, pagination: { hasMore: false } }) }),
    );
    await page.goto("/");

    await page.getByTestId("find-skills-nav-button").click();
    const palette = page.getByTestId("find-skills-palette");
    await expect(palette).toBeVisible();

    // The combobox must be the active element on the very next animation
    // frame (no perceptible delay). useLayoutEffect guarantees this; a
    // setTimeout-based focus would flake here.
    const focusedRoleEarly = await page.evaluate(() => document.activeElement?.getAttribute("role"));
    expect(focusedRoleEarly).toBe("combobox");
  });

  test("renders the redesigned chrome: card background, footer hints, accent rail on selection", async ({ page }) => {
    await page.route("**/api/v1/studio/search**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total: 0, pagination: { hasMore: false } }) }),
    );
    await page.goto("/");
    await page.getByTestId("find-skills-nav-button").click();
    const palette = page.getByTestId("find-skills-palette");
    await expect(palette).toBeVisible();

    // 1. Card has a non-transparent background (regression guard for the
    //    0741 baseline where var(--bg) wasn't defined and the underlying page
    //    bled through).
    const bg = await palette.locator("> div").nth(1).evaluate((el) =>
      getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");

    // 2. Footer with keyboard hints is mounted inside the palette card.
    const footer = palette.getByTestId("palette-footer");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("navigate");
    await expect(footer).toContainText("open");
    await expect(footer).toContainText("jump");
    // Result-count summary on the right ("N results" / "1 result").
    await expect(footer).toContainText(/\d+\s+results?/);

    // 3. Trending list rendered, first row is selected with aria-selected=true.
    const firstOption = palette.getByRole("option").first();
    await expect(firstOption).toHaveAttribute("aria-selected", "true");

    // 4. Selected row shows the ⌘1 / Ctrl 1 jump hint.
    await expect(firstOption).toContainText(/⌘\s*1|Ctrl\s*1/);
  });

  test("degrades gracefully when upstream search returns 502 search_unavailable", async ({ page }) => {
    // Force the exact production failure mode.
    await page.route("**/api/v1/studio/search**", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "search_unavailable" }) }),
    );
    await page.goto("/");
    await page.getByTestId("find-skills-nav-button").click();
    const palette = page.getByTestId("find-skills-palette");
    await expect(palette).toBeVisible();

    const input = palette.getByRole("combobox");
    await input.fill("open");

    // Soft banner appears — NOT the harsh red "search failed (502)" UI.
    const banner = palette.getByTestId("search-degraded-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/live search is offline/i);
    await expect(banner).toContainText(/showing trending matches/i);

    // The legacy red error block must NOT render when degraded.
    await expect(palette.getByTestId("search-error")).toHaveCount(0);

    // Trending entries that contain "open" still render — UX stays usable.
    const options = palette.getByRole("option");
    await expect(options.first()).toBeVisible();
    await expect(options.first()).toContainText("blucli"); // first openclaw match

    // Group header signals the fallback explicitly.
    await expect(palette).toContainText("TRENDING (FILTERED)");
  });
});
