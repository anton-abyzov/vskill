// ---------------------------------------------------------------------------
// 0863 T-008: E2E — POST /api/workspace/active re-roots the running server.
//
// Runs against the default Playwright webServer (dist/index.js eval serve
// --root e2e/fixtures), whose workspace is the isolated /tmp/vskill-e2e-workspace
// seeded with the fixtures project. Verifies the 0863 switch contract over real
// HTTP without restarting the process:
//   - switching to a known project returns { ok, root, skillCount } (200)
//   - a follow-up GET /api/skills succeeds against the (now-active) root
//   - switching to an unknown id returns 404 (no re-root)
//
// 0836: every /api/* request needs the per-process X-Studio-Token. The browser
// gets it injected into the served HTML; we extract it the same way the real
// client does, then pass it on the API calls. The UI click-to-switch flow
// (pill + sidebar + toast updating in place) is covered by the live preview
// verification recorded in the increment; here we pin the server-side re-root
// contract that makes that flow possible.
// ---------------------------------------------------------------------------

import { test, expect, type Page } from "@playwright/test";

async function studioToken(page: Page): Promise<string> {
  await page.goto("/");
  return page.evaluate(() => {
    const el = document.getElementById("__vskill_studio_token__");
    if (el?.textContent) {
      try {
        return (JSON.parse(el.textContent) as { token?: string }).token ?? "";
      } catch {
        /* fall through */
      }
    }
    return (window as unknown as { __VSKILL_STUDIO_TOKEN__?: string }).__VSKILL_STUDIO_TOKEN__ ?? "";
  });
}

test.describe("0863 folder switch — POST /api/workspace/active re-roots in place", () => {
  test("switching to a known project returns { ok, root, skillCount } and re-scans", async ({ page, request }) => {
    const token = await studioToken(page);
    expect(token, "studio token injected into the shell HTML").not.toBe("");
    const headers = { "X-Studio-Token": token };

    const wsRes = await request.get("/api/workspace", { headers });
    expect(wsRes.status()).toBe(200);
    const ws = (await wsRes.json()) as {
      activeProjectId: string | null;
      projects: Array<{ id: string; path: string }>;
    };
    test.skip(ws.projects.length === 0, "no registered project in e2e workspace");

    const target = ws.projects.find((p) => p.id === ws.activeProjectId) ?? ws.projects[0];

    const switchRes = await request.post("/api/workspace/active", {
      headers,
      data: { id: target.id },
    });
    expect(switchRes.status()).toBe(200);
    const body = (await switchRes.json()) as {
      ok?: boolean;
      root?: string;
      skillCount?: number;
      activeProjectId?: string;
    };
    // 0863 envelope: success carries ok + the applied root + a fresh skill count.
    expect(body.ok).toBe(true);
    expect(body.activeProjectId).toBe(target.id);
    expect(body.root).toBe(target.path);
    expect(typeof body.skillCount).toBe("number");
    expect(body.skillCount).toBeGreaterThanOrEqual(0);

    // The running server now serves skills from the (re-applied) root.
    const skillsRes = await request.get("/api/skills?agent=claude-code", { headers });
    expect(skillsRes.status()).toBe(200);
  });

  test("switching to an unknown project id returns 404 (no re-root)", async ({ page, request }) => {
    const token = await studioToken(page);
    const res = await request.post("/api/workspace/active", {
      headers: { "X-Studio-Token": token },
      data: { id: "0863-definitely-unknown-id" },
    });
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
  });
});
