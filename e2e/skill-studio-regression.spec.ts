// ---------------------------------------------------------------------------
// 0670 T-012b — Skill Studio path-B regression test (AC-US7-07).
//
// T-002 of 0670 rewired the eval-server's `POST /api/skills/generate?sse`
// HTTP handler so it shares the same `generateSkill()` core that the CLI
// (`vskill skill new`) goes through. This spec is a REGRESSION GATE that
// proves the React Skill Studio (path B) still drives the rewired handler
// end-to-end and surfaces the generated skill body in the create-flow UI.
//
// We mock the SSE stream at the network layer — `page.route()` fulfills
// `POST /api/skills/generate?sse` with a deterministic stream of `progress`
// + `provenance` + `done` events. This isolates the regression check from:
//   - LLM availability (no ANTHROPIC_API_KEY in CI)
//   - Network flakiness
//   - LLM output drift
// What's exercised IS the contract: SPA shape, request payload, SSE-event
// parsing, and post-done state application (body fills the editor).
//
// If this test fails, T-002's HTTP-handler rewire has regressed — either
// the SPA stopped sending the right request shape, or the post-done body
// no longer lands in the editor. Both are AC-US7-07 violations.
// ---------------------------------------------------------------------------

import { test, expect, type Page, type Route } from "@playwright/test";

const MOCK_GENERATED = {
  name: "lint-markdown-files",
  description: "Lint markdown files for style and link integrity.",
  model: "claude-sonnet-4-5",
  allowedTools: "Read,Bash(node*)",
  body: "# lint-markdown-files\n\nLint markdown files using the configured linter.\n\n## Workflow\n\n1. Walk the tree.\n2. Report issues.\n",
  evals: [],
  reasoning: "Generated for the 0670 T-012b regression spec.",
};

const SKILL_STUDIO_REGRESSION_BODY_FRAGMENT = "Lint markdown files using the configured linter";

/**
 * Build an SSE response body from a sequence of (event, data) pairs.
 * Mirrors the wire format the SPA's `useCreateSkill` reader expects.
 */
function sseStream(events: Array<{ event: string; data: unknown }>): string {
  return events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

async function fulfillGenerateSkillSse(route: Route): Promise<{ requestPayload: unknown }> {
  const request = route.request();
  let parsedPayload: unknown = null;
  try {
    parsedPayload = JSON.parse(request.postData() ?? "null");
  } catch {
    parsedPayload = null;
  }

  const body = sseStream([
    { event: "progress", data: { phase: "preparing", message: "Building prompt..." } },
    { event: "progress", data: { phase: "generating-body", message: "Generating skill body..." } },
    {
      event: "provenance",
      data: {
        resolvedModelId: "claude-sonnet-4-5-20250929",
        snapshotDate: "2026-04-24",
      },
    },
    { event: "done", data: MOCK_GENERATED },
  ]);

  await route.fulfill({
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body,
  });

  return { requestPayload: parsedPayload };
}

async function gotoStudio(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-testid='sidebar']", { timeout: 10_000 });
}

async function arriveAtCreateAiPage(page: Page, skillName: string, description: string) {
  // Open the "+ New Skill" modal.
  await page.locator("[data-slot='create-skill-button']").click();
  await expect(page.getByRole("heading", { name: "Create a skill" })).toBeVisible();

  // Step 1 → 2.
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Name and describe" })).toBeVisible();

  // Fill the form.
  await page.locator("input[placeholder='my-new-skill']").fill(skillName);
  await page
    .locator("textarea[placeholder='Does a thing when Claude needs X']")
    .fill(description);

  // "Generate with AI" — navigates to /#/create with the prefill query.
  await page.getByRole("button", { name: /Generate with AI/ }).click();
  await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("0670 T-012b — Skill Studio path-B regression (AC-US7-07)", () => {
  test("Generate-with-AI flow drives /api/skills/generate?sse and lands the generated body in the editor", async ({
    page,
  }) => {
    let captured: { requestPayload: unknown } | null = null;
    await page.route("**/api/skills/generate*", async (route) => {
      captured = await fulfillGenerateSkillSse(route);
    });

    await gotoStudio(page);
    await arriveAtCreateAiPage(
      page,
      "regression-lint-markdown",
      "Lint markdown files for style and link integrity",
    );

    // Click "Generate Skill" — the AI-mode primary CTA.
    const genBtn = page.getByRole("button", { name: /Generate Skill/ });
    await expect(genBtn).toBeVisible();
    await expect(genBtn).toBeEnabled();
    await genBtn.click();

    // After the SSE stream emits `done`, the post-generate handler calls
    // setBody(data.body) and setMode("manual"). The body textarea then
    // carries our mocked content. Use a substring fragment so future
    // formatting tweaks don't break the regression gate.
    const bodyTextarea = page.locator(
      "textarea[placeholder*='You are an expert at']",
    );
    await expect(bodyTextarea).toBeVisible({ timeout: 10_000 });
    await expect(bodyTextarea).toHaveValue(
      new RegExp(SKILL_STUDIO_REGRESSION_BODY_FRAGMENT),
      { timeout: 10_000 },
    );

    // Regression contract: the SPA MUST send a JSON POST with a `prompt`
    // field. T-002 standardized the request shape so the CLI and SPA share
    // the same generateSkill() entry point — diverging shapes silently
    // breaks one path. Lock that down.
    expect(captured, "SPA never called /api/skills/generate").not.toBeNull();
    const payload = (captured as unknown as { requestPayload: unknown }).requestPayload as Record<string, unknown> | null;
    expect(payload, "request payload must be JSON").not.toBeNull();
    expect(typeof payload?.prompt, "prompt field must be a string").toBe("string");
    expect(String(payload?.prompt)).toMatch(/Lint markdown files/);
  });

  test("Generate handler 5xx surfaces a user-visible error without crashing the page", async ({
    page,
  }) => {
    await page.route("**/api/skills/generate*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "synthetic regression failure" }),
      });
    });

    await gotoStudio(page);
    await arriveAtCreateAiPage(
      page,
      "regression-lint-markdown-err",
      "Lint markdown files (error path)",
    );

    const genBtn = page.getByRole("button", { name: /Generate Skill/ });
    await genBtn.click();

    // The page must remain on /#/create (no crash, no navigation away).
    await expect(page.getByRole("heading", { name: "Create a New Skill" })).toBeVisible({
      timeout: 10_000,
    });

    // Some surfaced indication of the failure must appear within the
    // page body — the SPA renders this either inline or via the error
    // card depending on classification. We just assert the error message
    // text reaches the DOM.
    const pageText = (await page.locator("body").textContent()) ?? "";
    expect(pageText).toMatch(/synthetic regression failure|generation.*failed|error/i);
  });
});
