// ---------------------------------------------------------------------------
// 0759 — Studio Publish E2E verification.
//
// Drives the studio UI through the publish loop with both git endpoints
// stubbed via `page.route` so we don't need a real remote, real auth, or a
// real `git push`. We assert: (1) the Publish button appears when the studio
// reports a remote, (2) clicking it triggers a popup whose URL is the
// verified-skill.com submit page with the canonical repo URL pre-filled.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

const FIXTURE_REMOTE_SSH = "git@github.com:owner/test-repo.git";
const EXPECTED_CANONICAL = "https://github.com/owner/test-repo";

async function stubGitRoutes(page: Page) {
  await page.route("**/api/git/remote", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        remoteUrl: FIXTURE_REMOTE_SSH,
        branch: "main",
        hasRemote: true,
      }),
    });
  });
  await page.route("**/api/git/publish", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        commitSha: "abc1234def5678",
        branch: "main",
        remoteUrl: FIXTURE_REMOTE_SSH,
        stdout: "Everything up-to-date\n",
        stderr: "",
      }),
    });
  });
}

test.describe("0759 — Studio Publish flow", () => {
  test("Publish button appears, click opens verified-skill.com submit popup with ?repo=", async ({
    page,
    context,
  }) => {
    await stubGitRoutes(page);

    await page.goto("/");

    // Wait for the studio shell to settle. Sidebar load is the universal
    // "studio is interactive" signal across e2e specs.
    await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });

    // Open the first skill we can find so the EditorPanel renders.
    const firstSkill = page.locator("[data-slot='sidebar-skill']").first();
    await expect(firstSkill).toBeVisible({ timeout: 10_000 });
    await firstSkill.click();

    // The Publish button is rendered next to Save when /api/git/remote
    // reports hasRemote:true. Our route stub guarantees that.
    const publishBtn = page.locator('button[aria-label="Publish"]');
    await expect(publishBtn).toBeVisible({ timeout: 10_000 });

    // Click and wait for the popup. window.open with target=_blank fires a
    // popup event on the BrowserContext.
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      publishBtn.click(),
    ]);

    const expectedRepoEncoded = encodeURIComponent(EXPECTED_CANONICAL);
    expect(popup.url()).toBe(
      `https://verified-skill.com/submit?repo=${expectedRepoEncoded}`,
    );
  });
});
