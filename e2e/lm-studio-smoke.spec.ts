// ---------------------------------------------------------------------------
// 0677 — Playwright smoke test for the LM Studio provider.
//
// Contract (AC-US4-04):
//   - If LM Studio's /v1/models endpoint is not reachable at test time, the
//     entire suite is skipped (test.skip with a descriptive message). CI
//     runners without LM Studio installed must see "skipped", not "failed".
//   - If reachable, the test walks through the UI config surface to confirm
//     LM Studio is listed as an available provider and the first loaded
//     model can be selected via the /api/config endpoint. We intentionally
//     do NOT run a full eval here to keep the suite fast even when LM
//     Studio is present — selecting the provider is the regression gate.
// ---------------------------------------------------------------------------

import { test, expect, request as playwrightRequest } from "@playwright/test";

const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";

/** Probe LM Studio directly (not via the eval server) so the skip gate is
 *  independent of the vskill server being up. 500ms timeout matches the
 *  server-side probe. */
async function isLmStudioReachable(): Promise<boolean> {
  const ctx = await playwrightRequest.newContext();
  try {
    const resp = await ctx.get(`${LM_STUDIO_BASE_URL}/models`, { timeout: 500 });
    return resp.ok();
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

test.describe("LM Studio provider smoke", () => {
  let reachable = false;

  test.beforeAll(async () => {
    reachable = await isLmStudioReachable();
  });

  test("LM Studio appears in /api/config providers when reachable", async ({ request }) => {
    test.skip(
      !reachable,
      `LM Studio not reachable at ${LM_STUDIO_BASE_URL}/models — install LM Studio and load a model to run this test.`,
    );

    const resp = await request.get("/api/config");
    expect(resp.ok()).toBe(true);
    const config = await resp.json();

    const lm = (config.providers as Array<{ id: string; available: boolean; models: Array<{ id: string }> }>)
      .find((p) => p.id === "lm-studio");

    expect(lm).toBeDefined();
    expect(lm!.available).toBe(true);
    expect(Array.isArray(lm!.models)).toBe(true);
    expect(lm!.models.length).toBeGreaterThan(0);
  });

  test("POST /api/config with provider=lm-studio selects the first loaded model", async ({ request }) => {
    test.skip(
      !reachable,
      `LM Studio not reachable at ${LM_STUDIO_BASE_URL}/models — install LM Studio and load a model to run this test.`,
    );

    const configResp = await request.get("/api/config");
    const config = await configResp.json();
    const lm = (config.providers as Array<{ id: string; models: Array<{ id: string }> }>)
      .find((p) => p.id === "lm-studio");
    const firstModel = lm!.models[0].id;

    const setResp = await request.post("/api/config", {
      data: { provider: "lm-studio", model: firstModel },
    });
    expect(setResp.ok()).toBe(true);
    const result = await setResp.json();
    expect(result.provider).toBe("lm-studio");
    expect(result.model).toBe(firstModel);
  });
});
