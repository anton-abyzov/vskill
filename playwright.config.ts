import { defineConfig } from "@playwright/test";

const RUN_LIVE = process.env.PLAYWRIGHT_RUN_LIVE === "1";

const baseWebServers = [
  {
    command: "node dist/index.js eval serve --root e2e/fixtures --port 3077",
    port: 3077,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
    // 0698 T-017: isolate the workspace registry so E2E runs do NOT touch the
    // developer's real ~/.vskill/workspace.json.
    env: {
      VSKILL_WORKSPACE_DIR: "/tmp/vskill-e2e-workspace",
    },
  },
];

// 0727 US-005 / AC-US5-01: second webServer that boots `wrangler dev` for the
// vskill-platform Worker. Gated on PLAYWRIGHT_RUN_LIVE=1 so default runs do
// NOT pay the wrangler cold-start cost.
const liveWebServer = {
  command: "cd ../vskill-platform && npx wrangler dev --port 8788",
  port: 8788,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
  env: {
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://localhost/vskill_e2e",
    GITHUB_WEBHOOK_SECRET: "test-secret-for-e2e",
    INTERNAL_BROADCAST_KEY: "test-broadcast-key",
  },
};

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3077",
    headless: true,
  },
  // 0727 US-005 / AC-US5-02 (F-004): globalSetup resolves to the sibling
  // vskill-platform repo's `__tests__/e2e/global-setup.ts`. The hook itself
  // is a no-op unless `PLAYWRIGHT_RUN_LIVE=1` (so default project runs are
  // unaffected). Without this wiring, the live spec would race against an
  // empty DB and the webhook handler's repo→skill lookup would return no
  // matches.
  globalSetup: RUN_LIVE
    ? require.resolve("../vskill-platform/__tests__/e2e/global-setup.ts")
    : undefined,
  // Default project skips `-live.spec.ts` files. Live project opt-in via
  // `PLAYWRIGHT_RUN_LIVE=1 npx playwright test --project=live`.
  projects: [
    {
      name: "default",
      testIgnore: /-live\.spec\.ts$/,
    },
    {
      name: "live",
      testMatch: /-live\.spec\.ts$/,
      grep: /@live/,
    },
  ],
  webServer: RUN_LIVE ? [...baseWebServers, liveWebServer] : baseWebServers,
});
