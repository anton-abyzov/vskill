import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0734 T-025 / T-026: engine selector, version input and [Install] on /create.
//
// ACs covered:
//   AC-US6-02: the built Studio renders the engine selector, the version input
//              and, for a missing engine, the [Install] button on /create
//   AC-US2-06: engine-selector-{vskill|anthropic-skill-creator|none} test ids
//   AC-US5-04: [Install] opens the consent modal with the exact command; no
//              install request fires until [Run install] is clicked
//
// The first test runs against the real detect-engines answer of the
// eval-server (webServer in playwright.config.ts), so whichever engine is
// missing on the machine must show [Install]. The second pins detection with
// page.route() so the missing-engine path is always exercised.
// ---------------------------------------------------------------------------

const ENGINES = ["vskill", "anthropic-skill-creator", "none"] as const;

async function openCreatePage(page: Page): Promise<void> {
  await page.goto("/#/create");
  await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({ timeout: 10_000 });
}

test.describe("0734 — create-skill engine selector + version", () => {
  test("renders all three engine options, Install for missing engines, and version 1.0.0", async ({ page }) => {
    // Read the answer the page itself got (it carries the Studio token).
    const detectResponse = page.waitForResponse((r) => r.url().includes("/api/studio/detect-engines"));
    await openCreatePage(page);
    const res = await detectResponse;
    expect(res.ok()).toBe(true);
    const detection = (await res.json()) as { vskillSkillBuilder: boolean; anthropicSkillCreator: boolean };

    for (const engine of ENGINES) {
      await expect(page.getByTestId(`engine-selector-${engine}`)).toBeVisible();
    }

    const expectedDefault = detection.vskillSkillBuilder
      ? "vskill"
      : detection.anthropicSkillCreator
        ? "anthropic-skill-creator"
        : "none";
    await expect(page.getByTestId(`engine-selector-${expectedDefault}`)).toHaveAttribute("aria-selected", "true");

    const installVskill = page.getByTestId("install-vskill");
    const installAnthropic = page.getByTestId("install-anthropic-skill-creator");
    if (detection.vskillSkillBuilder) await expect(installVskill).toHaveCount(0);
    else await expect(installVskill).toBeVisible();
    if (detection.anthropicSkillCreator) await expect(installAnthropic).toHaveCount(0);
    else await expect(installAnthropic).toBeVisible();
    await expect(page.getByTestId("install-none")).toHaveCount(0);

    // The version input lives in Manual mode.
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await expect(page.getByTestId("version-input")).toHaveValue("1.0.0");

    await page.screenshot({ path: "test-results/0734-create-engine-selector.png", fullPage: true });
  });

  test("missing engine shows Install; Install opens the consent modal without running anything", async ({ page }) => {
    await page.route("**/api/studio/detect-engines", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          vskillSkillBuilder: false,
          anthropicSkillCreator: true,
          vskillVersion: null,
          anthropicPath: "/home/user/.claude/skills/skill-creator",
        }),
      }),
    );
    const installRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/studio/install-engine")) installRequests.push(req.url());
    });

    await openCreatePage(page);

    await expect(page.getByTestId("engine-selector-anthropic-skill-creator")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("install-anthropic-skill-creator")).toHaveCount(0);
    const install = page.getByTestId("install-vskill");
    await expect(install).toBeVisible();

    await install.click();
    const modal = page.getByTestId("install-engine-modal");
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("install-command-preview")).toContainText("vskill install");
    await expect(page.getByTestId("install-security-note")).toBeVisible();
    await expect(page.getByTestId("install-run")).toBeVisible();
    await page.screenshot({ path: "test-results/0734-install-engine-modal.png", fullPage: true });

    await page.getByTestId("install-cancel").click();
    await expect(modal).toHaveCount(0);
    expect(installRequests).toEqual([]);
  });
});
