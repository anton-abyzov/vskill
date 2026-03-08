import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Smoke: server and static UI load
// ---------------------------------------------------------------------------

test("health endpoint returns ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

test("UI loads with sidebar and heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=Skill Eval")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Skills list
// ---------------------------------------------------------------------------

test("GET /api/skills returns test-skill", async ({ request }) => {
  const res = await request.get("/api/skills");
  expect(res.ok()).toBe(true);
  const skills = await res.json();
  expect(Array.isArray(skills)).toBe(true);
  const ts = skills.find((s: any) => s.skill === "test-skill");
  expect(ts).toBeDefined();
  expect(ts.plugin).toBe("test-plugin");
  expect(ts.hasEvals).toBe(true);
  expect(ts.hasBenchmark).toBe(true);
  expect(ts.evalCount).toBe(2);
  expect(ts.assertionCount).toBe(4);
});

test("skills list page shows test-skill", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=test-skill")).toBeVisible();
  await expect(page.locator("text=test-plugin")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Skill detail and evals CRUD
// ---------------------------------------------------------------------------

test("GET /api/skills/:plugin/:skill returns skill content", async ({ request }) => {
  const res = await request.get("/api/skills/test-plugin/test-skill");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.skillContent).toContain("test assistant");
});

test("GET /api/skills/:plugin/:skill/evals returns eval cases", async ({ request }) => {
  const res = await request.get("/api/skills/test-plugin/test-skill/evals");
  expect(res.ok()).toBe(true);
  const evals = await res.json();
  expect(evals.skill_name).toBe("test-skill");
  expect(evals.evals).toHaveLength(2);
  expect(evals.evals[0].name).toBe("basic-test-question");
  expect(evals.evals[0].assertions).toHaveLength(2);
  expect(evals.evals[1].name).toBe("edge-case-testing");
});

test("PUT /api/skills/:plugin/:skill/evals validates body", async ({ request }) => {
  const res = await request.put("/api/skills/test-plugin/test-skill/evals", {
    data: { skill_name: "", evals: [] },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.errors.length).toBeGreaterThan(0);
});

test("PUT /api/skills/:plugin/:skill/evals saves valid data", async ({ request }) => {
  // Read original to restore later
  const original = await (await request.get("/api/skills/test-plugin/test-skill/evals")).json();

  const updated = {
    ...original,
    evals: [
      ...original.evals,
      {
        id: 99,
        name: "new-case",
        prompt: "Test prompt",
        expected_output: "Expected output",
        files: [],
        assertions: [{ id: "new-a", text: "New assertion", type: "boolean" }],
      },
    ],
  };

  const res = await request.put("/api/skills/test-plugin/test-skill/evals", { data: updated });
  expect(res.ok()).toBe(true);

  // Verify it persisted
  const check = await (await request.get("/api/skills/test-plugin/test-skill/evals")).json();
  expect(check.evals).toHaveLength(3);

  // Restore original
  await request.put("/api/skills/test-plugin/test-skill/evals", { data: original });
});

// ---------------------------------------------------------------------------
// Benchmark latest
// ---------------------------------------------------------------------------

test("GET /api/skills/:plugin/:skill/benchmark/latest returns benchmark", async ({ request }) => {
  const res = await request.get("/api/skills/test-plugin/test-skill/benchmark/latest");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.skill_name).toBe("test-skill");
  expect(json.cases).toHaveLength(2);
  expect(json.cases[0].status).toBe("pass");
  expect(json.cases[1].status).toBe("fail");
});

// ---------------------------------------------------------------------------
// History (initially empty in fixtures)
// ---------------------------------------------------------------------------

test("GET /api/skills/:plugin/:skill/history returns array", async ({ request }) => {
  const res = await request.get("/api/skills/test-plugin/test-skill/history");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(Array.isArray(json)).toBe(true);
});

// ---------------------------------------------------------------------------
// 404 handling
// ---------------------------------------------------------------------------

test("GET /api/skills/nonexistent/skill returns empty detail", async ({ request }) => {
  const res = await request.get("/api/skills/nonexistent/skill");
  expect(res.ok()).toBe(true);
  const json = await res.json();
  expect(json.skillContent).toBe("");
});

test("GET /api/skills/nonexistent/skill/evals returns error", async ({ request }) => {
  const res = await request.get("/api/skills/nonexistent/skill/evals");
  expect(res.ok()).toBe(false);
});

test("GET /api/unknown-route returns 404", async ({ request }) => {
  const res = await request.get("/api/unknown-route");
  expect(res.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// UI navigation
// ---------------------------------------------------------------------------

test("skill list links navigate to detail page", async ({ page }) => {
  await page.goto("/");
  // Find and click a link containing "test-skill"
  const link = page.locator("a", { hasText: "test-skill" }).first();
  await expect(link).toBeVisible();
  await link.click();
  // Should navigate to skill detail page
  await expect(page).toHaveURL(/#.*test-plugin.*test-skill/);
});
