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
//   - Webhook and versions calls go straight to the wrangler dev Worker on
//     `http://localhost:8788`. The Studio is the live-only eval server on
//     :3078 (playwright.config `liveStudioServer`), rooted at
//     e2e/fixtures-live: its vskill.lock installs the platform fixture skill
//     (anton-abyzov/greet-anton-test hello-skill) at 1.0.0, and its platform
//     calls go to :8788 instead of verified-skill.com.
//   - The fixture repo is real and public; its SKILL.md on main is 1.1.0,
//     while the seed (vskill-platform __tests__/e2e/global-setup.ts) records
//     1.0.0, so the webhook-triggered scan writes a 1.1.0 SkillVersion.
//   - The DB-row assertion polls `GET /api/v1/skills/<owner>/<repo>/<skill>/versions`;
//     a new SkillVersion row is the visible downstream artifact of the scan.
//   - The badge assertion is the push itself: the Studio has already polled
//     (installed 1.0.0 == latest 1.0.0, no badge) and opened its UpdateHub
//     stream before the webhook, so only the streamed skill.updated event
//     can raise the count.
// ---------------------------------------------------------------------------
import { test, expect } from "@playwright/test";

const PLATFORM_BASE = "http://localhost:8788";
const STUDIO_BASE = "http://localhost:3078";
// Must match E2E_FIXTURE_REPO in vskill-platform/__tests__/e2e/global-setup.ts.
const FIXTURE_REPO = "https://github.com/anton-abyzov/greet-anton-test";
// Must match E2E_FIXTURE_SKILL_NAME in the platform seed.
const FIXTURE_SKILL_NAME = "anton-abyzov/greet-anton-test/hello-skill";
// Must match E2E_FIXTURE_SKILL_ID in the platform seed.
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
  test("@live signed webhook → DB row → SSE → UpdateBell badge increments", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // 1. Build a `push` payload identical to GitHub's wire shape.
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      repository: {
        html_url: FIXTURE_REPO,
        default_branch: "main",
      },
      head_commit: {
        // Informational only: the scanner reads the branch head from GitHub.
        id: "a9b43f56e03fa30c1d9f5148f95a3371a36c77e3",
      },
    });
    const signature = `sha256=${await hmacHex(FIXTURE_SECRET, payload)}`;

    // 2. Open Studio FIRST and wait for its UpdateHub stream (opened only
    //    after the installed skill resolved to its platform id) so we observe
    //    a push, not a poll. No update is known yet, so no badge.
    const streamOpened = page.waitForResponse(
      // The first stream subscribes with local ids; wait for the one the
      // Studio opens after resolving the installed skill to its platform id.
      (r) =>
        r.url().includes("/api/v1/skills/stream?skills=") &&
        decodeURIComponent(r.url()).includes(FIXTURE_SKILL_ID) &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await page.goto(`${STUDIO_BASE}/studio`);
    await page.waitForSelector('[data-testid="update-bell"]', { timeout: 10_000 });
    await streamOpened;
    await expect(page.locator('[data-testid="update-bell-badge"]')).toHaveCount(0);

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
            `${PLATFORM_BASE}/api/v1/skills/${FIXTURE_SKILL_NAME}/versions`,
          );
          if (!res.ok) return [];
          const body = (await res.json()) as { versions?: { version: string }[] };
          return (body.versions ?? []).map((v) => v.version);
        },
        { timeout: 15_000, intervals: [200, 400, 800] },
      )
      .toContain("1.1.0");

    // 5. The Studio's UpdateBell badge increments within 2s of the scan:
    //    the outbox write is published to the UpdateHub DO, which streams
    //    skill.updated (1.1.0) to the Studio, which marks the installed
    //    1.0.0 copy outdated.
    await expect(
      page.locator('[data-testid="update-bell-badge"]'),
    ).toContainText(/[1-9]/, { timeout: 2_000 });
  });
});
