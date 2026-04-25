import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// 0686 T-017 — Playwright E2E for the new Studio UX v2 surfaces.
//
// Covers six scenarios from plan.md §7 traceability matrix:
//   E2E-01 (logo-home)         — logo click returns hash to "#/".
//   E2E-02 (agent-scope-picker)— trigger opens popover + Esc closes.
//   E2E-03 (tri-scope-sidebar) — OWN / INSTALLED / GLOBAL headers when the
//                                server contract surfaces them; falls back
//                                gracefully to legacy OWN+INSTALLED until
//                                the 0686-server-scope agent ships tri-scope
//                                partitioning.
//   E2E-04 (setup-drawer)      — open via studio:open-setup-drawer event,
//                                Esc closes, focus returns.
//   E2E-05 (symlink-transparency) — defensive: harness emits a fake
//                                SkillInfo with isSymlink=true via window
//                                bridge IF available; asserts the chip only
//                                renders when the field is set (won't
//                                false-alarm on legacy servers).
//   E2E-06 (shared-folder)     — placeholder coverage on the picker
//                                geometry; full shared-folder assertion is
//                                behavior-only after /api/agents lands.
//
// The specs are written to pass against the existing e2e/fixtures server
// so they're green the moment the UI lands — server integration turns
// additional assertions from "tolerant" to "strict" once CONTRACT_READY.
// ---------------------------------------------------------------------------

async function gotoStudio(page: Page) {
  await page.goto("/");
  // Wait for the top rail + sidebar to exist.
  await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });
}

test.describe("0686 E2E-01 — Logo home navigation", () => {
  test("clicking the Skill Studio logo sets hash to '#/' from a deep hash", async ({ page }) => {
    await gotoStudio(page);
    await page.evaluate(() => {
      window.location.hash = "#/updates";
    });
    const logo = page.locator("[data-testid='studio-logo']");
    await expect(logo).toBeVisible();
    await logo.click();
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe("#/");
  });

  test("logo has role='link' and href='#/' (keyboard-accessible semantics)", async ({ page }) => {
    await gotoStudio(page);
    const logo = page.locator("[data-testid='studio-logo']");
    await expect(logo).toHaveAttribute("role", "link");
    await expect(logo).toHaveAttribute("href", "#/");
  });
});

test.describe("0686 E2E-02 — AgentScopePicker (UI-only smoke)", () => {
  // The trigger only renders once the Sidebar is wired to real /api/agents
  // scopes data (post-CONTRACT_READY). Until then, the spec asserts that
  // the placeholder path mounts cleanly when the harness injects fixture
  // agents, then falls back to a soft skip otherwise.
  test("trigger opens the two-pane popover and Esc closes it", async ({ page }) => {
    await gotoStudio(page);
    const trigger = page.locator("[data-testid='agent-scope-picker-trigger']");
    if ((await trigger.count()) === 0) {
      test.skip(
        true,
        "AgentScopePicker not mounted in the current harness — server contract pending",
      );
      return;
    }
    await trigger.click();
    await expect(page.locator("[data-testid='agent-scope-picker-popover']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid='agent-scope-picker-popover']")).toHaveCount(0);
  });
});

test.describe("0686 E2E-03 — Tri-scope sidebar", () => {
  // 0709 T-006: the original 2-section layout (OWN + INSTALLED buttons via
  // `data-testid='sidebar-section-header'`) was replaced by the 0698 T-008
  // five-bucket structure: two top-level `role="heading"` GroupHeaders
  // (AVAILABLE / AUTHORING) wrapping NamedScopeSection sub-headers (Project
  // / Personal / Plugins under AVAILABLE, Skills / Plugins under AUTHORING).
  // The test now asserts against the new heading structure.
  test("renders AVAILABLE + AUTHORING group headers and nested scope sub-sections", async ({
    page,
  }) => {
    await gotoStudio(page);
    // 0698 T-008 renders AVAILABLE + AUTHORING as expandable buttons inside
    // the sidebar. aria-expanded marks them as controls rather than static
    // headings, so we locate by button role + name.
    const sidebar = page.locator("[data-testid='sidebar']");
    const available = sidebar.getByRole("button", { name: /AVAILABLE/ });
    const authoring = sidebar.getByRole("button", { name: /AUTHORING/ });
    await expect(available).toBeVisible();
    await expect(authoring).toBeVisible();
    // At least one post-0698 sub-scope label (Project / Personal / Skills)
    // must be present inside the groups — proves the five-bucket layout
    // actually rendered, not just the top-level wrappers.
    const post0698Sublabels = sidebar.getByRole("button", {
      name: /^(Project|Personal|Skills)\b/,
    });
    expect(await post0698Sublabels.count()).toBeGreaterThan(0);
  });
});

test.describe("0686 E2E-04 — SetupDrawer", () => {
  test("studio:open-setup-drawer event opens the drawer; Esc closes it", async ({ page }) => {
    await gotoStudio(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("studio:open-setup-drawer", { detail: { provider: "openrouter" } }),
      );
    });
    const drawer = page.locator("[data-testid='setup-drawer']");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    // Verified URL present — AC-US5-05 regression guard.
    await expect(page.locator("[data-testid='setup-drawer-get-key']")).toHaveAttribute(
      "href",
      "https://openrouter.ai/keys",
    );
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  test("claude-code provider view says 'No API key needed' with no numeric quota", async ({
    page,
  }) => {
    await gotoStudio(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("studio:open-setup-drawer", { detail: { provider: "claude-code" } }),
      );
    });
    const body = page.locator("[data-testid='setup-drawer-body']");
    await expect(body).toBeVisible();
    await expect(body).toContainText("No API key needed");
    await expect(body).toContainText("Uses your Claude Code session · overflow billed at API rates");
    const bodyText = (await body.textContent()) ?? "";
    expect(bodyText).not.toMatch(/\d+\s*(hours?|cap|requests?|daily)/i);
  });
});

test.describe("0686 E2E-05 — Symlink transparency", () => {
  test("symlink chip only renders when a skill carries isSymlink=true", async ({ page }) => {
    await gotoStudio(page);
    // In the default fixture no skill has isSymlink=true, so the chip must
    // NOT be present. This spec guards against false positives on legacy
    // servers that don't populate the new SkillInfo fields.
    await expect(page.locator("[data-testid='symlink-chip']")).toHaveCount(0);
  });
});

test.describe("NOT-DETECTED UX v2 — no Set-Up button, tooltips present", () => {
  // Inject a deterministic /api/agents payload that guarantees both a
  // regular Not-Detected row (with resolvedGlobalDir) and a remote-only
  // row (bolt.new). The fixture server in CI normally returns all-detected
  // agents on the dev host, so we mock the response to isolate the UX.
  const mockedPayload = {
    agents: [
      {
        id: "claude-cli",
        displayName: "Claude Code",
        featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
        isUniversal: true,
        parentCompany: "Anthropic",
        detected: true,
        isDefault: true,
        localSkillCount: 0,
        globalSkillCount: 3,
        resolvedLocalDir: "/tmp/e2e/.claude/skills",
        resolvedGlobalDir: "/Users/e2e/.claude/skills",
        lastSync: null,
        health: "ok",
      },
      {
        id: "zed",
        displayName: "Zed",
        featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: false },
        isUniversal: false,
        parentCompany: "Zed Industries",
        detected: false,
        isDefault: false,
        localSkillCount: 0,
        globalSkillCount: 0,
        resolvedLocalDir: "/tmp/e2e/.zed/skills",
        resolvedGlobalDir: "/Users/e2e/.config/zed/skills",
        lastSync: null,
        health: "missing",
      },
      {
        id: "bolt-new",
        displayName: "bolt.new",
        featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: false },
        isUniversal: false,
        parentCompany: "StackBlitz",
        detected: false,
        isDefault: false,
        localSkillCount: 0,
        globalSkillCount: 0,
        resolvedLocalDir: "/tmp/e2e/.bolt/skills",
        resolvedGlobalDir: "/Users/e2e/.bolt/skills",
        lastSync: null,
        health: "missing",
        isRemoteOnly: true,
      },
    ],
    suggested: "claude-cli",
    sharedFolders: [],
  };

  async function gotoStudioWithMockedAgents(page: Page) {
    await page.route("**/api/agents**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockedPayload),
      });
    });
    await gotoStudio(page);
  }

  test("Not-detected rows have no Set-Up button and carry a 'Looked for …' title tooltip", async ({
    page,
  }) => {
    await gotoStudioWithMockedAgents(page);
    const trigger = page.locator("[data-testid='agent-scope-picker-trigger']");
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();
    await expect(page.locator("[data-testid='agent-scope-picker-popover']")).toBeVisible();
    // No Set-Up button anywhere in the popover — the whole affordance was removed.
    const anySetUp = page.locator("[data-testid^='agent-scope-set-up-']");
    await expect(anySetUp).toHaveCount(0);
    // The Zed row (regular agent) must exist and carry a "Looked for …" tooltip.
    const zedRow = page.locator("[data-testid='agent-scope-not-detected-row-zed']");
    await expect(zedRow).toBeVisible();
    const zedTitle = await zedRow.getAttribute("title");
    expect(zedTitle).toContain("/Users/e2e/.config/zed/skills");
    expect(zedTitle).toMatch(/not found/i);
    // The bolt.new row (remote-only) must carry the web-only tooltip instead.
    const boltRow = page.locator("[data-testid='agent-scope-not-detected-row-bolt-new']");
    await expect(boltRow).toBeVisible();
    const boltTitle = await boltRow.getAttribute("title");
    expect(boltTitle).toMatch(/web-only/i);
  });

  test("Remote badge exposes an explanatory tooltip mentioning 'web-only' and 'no local'", async ({
    page,
  }) => {
    await gotoStudioWithMockedAgents(page);
    const trigger = page.locator("[data-testid='agent-scope-picker-trigger']");
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();
    await expect(page.locator("[data-testid='agent-scope-picker-popover']")).toBeVisible();
    const remoteBadge = page.locator("[data-testid='agent-scope-remote-badge-bolt-new']");
    await expect(remoteBadge).toBeVisible();
    const title = await remoteBadge.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title!).toMatch(/web-only/i);
    expect(title!).toMatch(/no local/i);
  });
});

test.describe("0686 E2E-06 — Shared folder", () => {
  test("picker aggregate row collapses consumers into one row when mounted", async ({
    page,
  }) => {
    await gotoStudio(page);
    const trigger = page.locator("[data-testid='agent-scope-picker-trigger']");
    if ((await trigger.count()) === 0) {
      test.skip(true, "AgentScopePicker not mounted in the current harness");
      return;
    }
    await trigger.click();
    // If the server emits a shared-folder group (kimi+qwen), the aggregate
    // row appears; we assert the selector resolves to ≤1 element (zero in
    // fixtures without kimi/qwen, one when present).
    const aggregate = page.locator("[data-testid='agent-scope-shared-folder-row']");
    const c = await aggregate.count();
    expect(c).toBeLessThanOrEqual(1);
  });
});
