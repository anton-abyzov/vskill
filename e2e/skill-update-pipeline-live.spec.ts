// ---------------------------------------------------------------------------
// 0727 US-005 — Skill Update Push Pipeline (LIVE WIRE) E2E
//
// Covers ACs:
//   - AC-US5-01: spec lives at this path, contains zero `page.route(...)`
//                calls for skill-update endpoints, gated by `@live` tag.
//   - AC-US5-02: full wire path — signed webhook → DB row → SSE client →
//                UpdateBell badge increment.
//   - AC-US5-03: opt-in via PLAYWRIGHT_RUN_LIVE=1 + --project=live; default
//                CI lane skips this spec entirely.
//
// Boot sequence (runbook):
//   1. Start local Postgres, export
//      `E2E_DATABASE_URL=postgresql://localhost/vskill_e2e`
//   2. From `vskill-platform/`: `npm run e2e:db-reset`
//   3. Export `GITHUB_WEBHOOK_SECRET=test-secret-for-e2e` and
//      `INTERNAL_BROADCAST_KEY=test-broadcast-key`
//   4. From `vskill/`:
//      `PLAYWRIGHT_RUN_LIVE=1 npx playwright test --project=live`
//
// Notes
//   - This spec runs against `http://localhost:8788` (the wrangler dev
//     instance the playwright.config webServer entry boots when
//     PLAYWRIGHT_RUN_LIVE=1).
//   - Studio's API base override happens via window.__VSKILL_API_BASE__,
//     which the addInitScript below installs before app code runs.
//   - The DB-row assertion uses `expect.poll` against the API-exposed
//     `GET /api/v1/skills/by-id/<id>/versions` endpoint. The vskill-platform
//     team has not yet added a "list update events" admin endpoint, so we
//     poll the versions list — a new SkillVersion row is the visible
//     downstream artifact of the webhook scan in the live rig.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

const PLATFORM_BASE = "http://localhost:8788";
const FIXTURE_REPO = "https://github.com/test-org/test-skill";
const FIXTURE_SKILL_ID = "skill-e2e-live";
const FIXTURE_SECRET = "test-secret-for-e2e";

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

test.describe("@live skill-update push pipeline (live wire)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([base]) => {
        (window as unknown as Record<string, unknown>).__VSKILL_API_BASE__ = base;
      },
      [PLATFORM_BASE],
    );
  });

  test("@live signed webhook → DB row → SSE → UpdateBell badge increments", async ({
    page,
  }) => {
    // 1. Build a `push` payload identical to GitHub's wire shape.
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      repository: {
        html_url: FIXTURE_REPO,
        default_branch: "main",
      },
      head_commit: {
        id: "abc123def456abc123def456abc123def456abcd",
      },
    });
    const signature = `sha256=${await hmacHex(FIXTURE_SECRET, payload)}`;

    // 2. Open Studio FIRST so EventSource is connected before the webhook
    //    fires — we need to observe a push, not a poll.
    await page.goto("/studio");
    await page.waitForSelector(
      '[data-testid="update-bell"], [aria-label*="updates" i]',
      { timeout: 10_000 },
    );

    // 3. POST signed webhook to the live wrangler dev Worker.
    const deliveryId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const response = await fetch(`${PLATFORM_BASE}/api/v1/webhooks/github`, {
      method: "POST",
      headers: {
        "x-hub-signature-256": signature,
        "x-github-event": "push",
        "x-github-delivery": deliveryId,
        "content-type": "application/json",
      },
      body: payload,
    });
    expect(response.status).toBe(200);

    // 4. Poll the versions API until the new SkillVersion row appears.
    //    A new version is the downstream artifact of the scan that the
    //    webhook enqueues — proves the full pipeline (queue → scanner →
    //    outbox-writer) ran end-to-end.
    await expect
      .poll(
        async () => {
          const res = await fetch(
            `${PLATFORM_BASE}/api/v1/skills/by-id/${FIXTURE_SKILL_ID}/versions`,
          );
          if (!res.ok) return 0;
          const body = (await res.json()) as { versions?: unknown[] };
          return body.versions?.length ?? 0;
        },
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThan(0);

    // 5. The Studio's UpdateBell badge increments within 2s of the SSE
    //    delivery (the platform's UpdateHub DO broadcasts on the new
    //    UpdateEvent row).
    await expect(
      page.locator('[data-testid="update-bell-badge"]'),
    ).toContainText(/[1-9]/, { timeout: 2_000 });
  });
});
