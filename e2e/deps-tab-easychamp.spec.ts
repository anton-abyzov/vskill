// ---------------------------------------------------------------------------
// 0707 T-033 — EasyChamp MCP showcase lives in the Deps tab.
//
// Given the easychamp/tournament-manager fixture skill, when the user
// opens the skill and clicks the Deps tab, the EasyChamp row must render
// under "MCP Servers" with a Copy-config button that emits the exact
// Claude-config JSON from the spec (stdio, npx -y easychamp-mcp, API-key
// env-var placeholder).
//
// Covers AC-US5-03 + AC-US5-04 from increment 0707.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

test.describe("0707 — Deps tab (EasyChamp showcase)", () => {
  test.use({
    // Playwright clipboard API requires the clipboard-read/write permissions
    // to be granted on the browser context.
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test("shows EasyChamp under MCP Servers and Copy-config emits the spec-shape JSON", async ({ page, context }) => {
    // Pre-grant clipboard perms against the served origin.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Deep-link directly to the fixture skill with the Deps panel active
    // via the ?panel=deps query param (panel deep-linking is handled by
    // SkillWorkspace.tsx).
    await page.goto("/?panel=deps#/skills/easychamp/tournament-manager");

    // Sidebar must load (waits for StudioContext → /api/skills response).
    await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });

    // Our fixture skill row resolves in the sidebar. If it doesn't show up
    // automatically via hash-restore, click the row explicitly to nudge
    // the SELECT_SKILL dispatch.
    const row = page.getByRole("button", { name: /tournament-manager/i }).first();
    await expect(row).toBeVisible();
    await row.click();

    // Ensure the Deps tab is active. The panel query param already handles
    // this on mount, but we click it explicitly to be robust to refreshes.
    const depsTab = page.getByRole("button", { name: /^Deps(\s|$)/ }).first();
    await expect(depsTab).toBeVisible();
    await depsTab.click();

    // --- MCP Servers section ------------------------------------------------
    // Header for the MCP block.
    await expect(page.getByText("MCP Servers", { exact: true })).toBeVisible();

    // EasyChamp row is rendered. The component shows the server name in a
    // text node alongside the transport badge — asserting visibility of the
    // literal "EasyChamp" string (unique to our fixture).
    await expect(page.getByText("EasyChamp", { exact: true })).toBeVisible();

    // stdio transport pill accompanies the row.
    await expect(page.locator("text=/^stdio$/")).toBeVisible();

    // The five tool chips should all be present (auto-detected from the body).
    for (const tool of [
      "easychamp_generate_league",
      "easychamp_generate_tournament",
      "easychamp_generate_bracket",
      "easychamp_create_schedule",
      "easychamp_enter_results",
    ]) {
      await expect(page.getByText(tool, { exact: true })).toBeVisible();
    }

    // --- Copy config action ------------------------------------------------
    const copyBtn = page.getByRole("button", { name: /Copy Config/i }).first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Button flips to "Copied!" for 2 s; meanwhile the clipboard holds
    // the serialized JSON snippet.
    await expect(page.getByRole("button", { name: /Copied!/i })).toBeVisible();

    // Read clipboard contents and validate the exact spec shape.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(clipboard);

    expect(parsed).toEqual({
      mcpServers: {
        easychamp: {
          command: "npx",
          args: ["-y", "easychamp-mcp"],
          env: { EASYCHAMP_API_KEY: "${EASYCHAMP_API_KEY}" },
        },
      },
    });

    // Security: the copied JSON must NOT contain a literal API key; only
    // the placeholder form is acceptable (G-S3).
    expect(clipboard).toContain("${EASYCHAMP_API_KEY}");
    expect(clipboard).not.toMatch(/EASYCHAMP_API_KEY"\s*:\s*"(?!\$\{)/);
  });
});
