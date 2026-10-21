import { test, expect, type Page } from "@playwright/test";

// Authoring smoke fixtures never need a real account, registry, or installed
// skill inventory. Keep background UI requests away from those surfaces.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith("http") && !["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith("/api/v1/account/")) return route.fulfill({status: 401, json: {error: "fixture signed out"}});
    if (url.pathname.startsWith("/api/v1/")) return route.fulfill({json: {results: []}});
    if (url.pathname === "/api/skills" || url.pathname === "/api/skills/updates") return route.fulfill({json: []});
    return route.continue();
  });
});

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
  test("renders all three engine options, Install for missing engines, and version 1.0.0", async ({ page }, testInfo) => {
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

    await page.screenshot({ path: testInfo.outputPath("0734-create-engine-selector.png"), fullPage: true });
  });

  test("missing engine shows Install; Install opens the consent modal without running anything", async ({ page }, testInfo) => {
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
    await page.screenshot({ path: testInfo.outputPath("0734-install-engine-modal.png"), fullPage: true });

    await page.getByTestId("install-cancel").click();
    await expect(modal).toHaveCount(0);
    expect(installRequests).toEqual([]);
  });
});


test("0734 gates missing engines and invalid versions before any request", async ({ page }, testInfo) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/studio/detect-engines", async (route) => {
    await waiting;
    await route.fulfill({ json: { vskillSkillBuilder: true, anthropicSkillCreator: false, vskillVersion: "1.0.0", anthropicPath: null } });
  });
  await openCreatePage(page);
  await expect(page.getByLabel("Detecting authoring engines")).toBeVisible();
  release();
  await expect(page.getByTestId("version-input")).toHaveValue("1.0.0");
  await page.getByPlaceholder(/^e.g., A skill/).fill("Create a fixture skill");
  await page.getByTestId("engine-selector-anthropic-skill-creator").click();
  await expect(page.getByRole("button", { name: "Generate Skill", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByPlaceholder("my-skill", { exact: true }).fill("fixture-skill");
  await page.getByPlaceholder("Brief description — used for auto-activation keywords").fill("Fixture");
  await expect(page.getByRole("button", { name: "Create Skill", exact: true })).toBeDisabled();
  await page.getByTestId("engine-selector-vskill").click();
  await page.getByTestId("version-input").fill("invalid");
  await page.getByTestId("version-input").blur();
  await expect(page.getByTestId("version-input-helper")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Skill", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("0734-version-guard.png"), fullPage: true });
});

test("0734 selected native engine reaches generation and preserves its document on save", async ({ page }, testInfo) => {
  await page.route("**/api/studio/detect-engines", (route) => route.fulfill({ json: { vskillSkillBuilder: true, anthropicSkillCreator: true, vskillVersion: "1.0.0", anthropicPath: "/fixture/skill-creator" } }));
  let generated: any;
  let saved: any;
  const nativeSkillMd = '---\nname: native-fixture\ndescription: Native fixture\ncontext: fork\nagent: Explore\nmetadata:\n  custom: retained\n---\nNative body\n';
  await page.route("**/api/skills/generate?*", async (route) => {
    generated = route.request().postDataJSON();
    await route.fulfill({ contentType: "text/event-stream", body: `event: done\ndata: ${JSON.stringify({ name: "native-fixture", description: "Native fixture", model: "", allowedTools: "Read", body: "Native body\n", nativeSkillMd })}\n\n` });
  });
  await page.route("**/api/skills/save-draft", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/skills/create", async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, plugin: "fixture", skill: "native-fixture" } }); });
  await openCreatePage(page);
  await page.getByTestId("engine-selector-anthropic-skill-creator").click();
  await page.getByTestId("version-input").fill("2.0.0");
  await page.getByPlaceholder(/^e.g., A skill/).fill("Native fixture only");
  await page.getByRole("button", { name: "Generate Skill", exact: true }).click();
  await expect(page.getByPlaceholder("my-skill", { exact: true })).toHaveValue("native-fixture");
  expect(generated).toMatchObject({ engine: "anthropic-skill-creator", provider: "claude-cli", targetAgents: ["claude-code"] });
  await expect(page.locator("pre").filter({ hasText: "context: fork" }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("0734-native-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Create Skill", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ version: "2.0.0", engine: "anthropic-skill-creator", nativeSkillMd });
});

test("0734 update route loads current version, clears optional fields and links version history", async ({ page }, testInfo) => {
  await page.route("**/api/studio/detect-engines", (route) => route.fulfill({ json: { vskillSkillBuilder: true, anthropicSkillCreator: false, vskillVersion: "1.0.0", anthropicPath: null } }));
  const nativeSkillMd = '---\nname: existing\ndescription: Existing\nmodel: opus\nallowed-tools:\n  - Read\n# retain permission note\n\n  - Bash\ncontext: fork\nmetadata:\n  version: "3.2.1"\n  custom: retained\n---\nExisting body';
  await page.route("**/api/skills/fixture/existing/authoring", (route) => route.fulfill({ json: { name: "existing", plugin: "", layout: 3, description: "Existing", body: "Existing body", model: "opus", allowedTools: "Read, Bash", version: "3.2.1", engine: "vskill", nativeSkillMd, versionsHref: "https://verified-skill.com/skills/owner/repo/existing/versions" } }));
  let saved: any;
  await page.route("**/api/skills/create", async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, plugin: "fixture", skill: "existing" } }); });
  await page.goto("/#/create?mode=update&pluginName=fixture&skillName=existing");
  await expect(page.getByTestId("version-input")).toHaveValue("3.2.1");
  await expect(page.getByTestId("version-input-versions-link")).toHaveAttribute("href", "https://verified-skill.com/skills/owner/repo/existing/versions");
  await expect(page.getByPlaceholder("my-skill", { exact: true })).toBeDisabled();
  const model = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "Any (default)" }) });
  await expect(model).toHaveValue("opus");
  await model.selectOption("");
  await expect(page.getByPlaceholder("Read, Write, Edit, Bash, Glob, Grep")).toHaveValue("Read, Bash");
  await page.getByPlaceholder("Read, Write, Edit, Bash, Glob, Grep").fill("");
  const preview = page.locator("pre").filter({ hasText: "context: fork" }).first();
  await expect(preview).not.toContainText("model: opus");
  await expect(preview).not.toContainText("allowed-tools:");
  await expect(preview).not.toContainText("- Bash");
  await expect(preview).toContainText("# retain permission note");
  await expect(preview).toContainText("custom: retained");
  await page.getByTestId("version-input").fill("3.2.2");
  await page.screenshot({ path: testInfo.outputPath("0734-update-version.png"), fullPage: true });
  await page.getByRole("button", { name: "Update Skill", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ mode: "update", name: "existing", version: "3.2.2", engine: "vskill", model: "", allowedTools: "", nativeSkillMd });
});
