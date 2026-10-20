import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

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
  // Worker bindings come from --var, not from this process env.
  // Fresh local KV/DO state per run, like CI: a scanner ETag or cached
  // check-updates answer left by an earlier run would hide the new version
  // from a freshly reset database.
  command:
    "cd ../vskill-platform && rm -rf .wrangler/e2e-state &&" +
    " npx wrangler dev --local --local-upstream localhost:8788 --port 8788 --persist-to .wrangler/e2e-state" +
    ` --var DATABASE_URL:${process.env.E2E_DATABASE_URL ?? "postgresql://localhost/vskill_e2e"}` +
    " --var GITHUB_WEBHOOK_SECRET:test-secret-for-e2e --var INTERNAL_BROADCAST_KEY:test-broadcast-key" +
    // The update scanner reads the fixture repo through the GitHub API; a
    // token lifts the 60 req/h unauthenticated limit. The shell expands it,
    // so the value never appears in the command string.
    (process.env.GITHUB_TOKEN ? ' --var "GITHUB_TOKEN:$GITHUB_TOKEN"' : ""),
  port: 8788,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
  env: {
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://localhost/vskill_e2e",
    // wrangler dev refuses to start without a local stand-in for the HYPERDRIVE binding.
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
      process.env.E2E_DATABASE_URL ?? "postgresql://localhost/vskill_e2e",
    GITHUB_WEBHOOK_SECRET: "test-secret-for-e2e",
    INTERNAL_BROADCAST_KEY: "test-broadcast-key",
  },
};

// Live-only Studio for the update-pipeline spec. Its root (e2e/fixtures-live)
// holds a vskill.lock and an installed copy of the platform fixture skill one
// version behind upstream, and it talks to the local platform instead of
// verified-skill.com, so a webhook-driven skill.updated event can light the
// Studio update bell end to end.
const liveStudioServer = {
  command: `node ${fileURLToPath(new URL("./dist/index.js", import.meta.url))} eval serve --root . --port 3078`,
  cwd: fileURLToPath(new URL("./e2e/fixtures-live", import.meta.url)),
  port: 3078,
  reuseExistingServer: !process.env.CI,
  timeout: 10_000,
  env: {
    VSKILL_WORKSPACE_DIR: "/tmp/vskill-e2e-live-workspace",
    VSKILL_PLATFORM_URL: "http://localhost:8788",
    VSKILL_API_BASE: "http://localhost:8788",
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
  // Plain path (resolved against this config's directory): the config loads
  // as ESM, where `require` does not exist.
  globalSetup: RUN_LIVE ? "../vskill-platform/__tests__/e2e/global-setup.ts" : undefined,
  // Default project skips `-live.spec.ts` files. Live project opt-in via
  // `PLAYWRIGHT_RUN_LIVE=1 npx playwright test --project=live`.
  // 0830 US-009 AC-US9-04: `desktop` project carries the auto-update smoke
  // spec — runs darwin-only (the spec self-skips elsewhere via
  // `test.skip(process.platform !== 'darwin')`). Default project ignores
  // `e2e/desktop/**` so a regular `playwright test` run is unaffected.
  projects: [
    {
      name: "default",
      testIgnore: [/-live\.spec\.ts$/, /e2e\/desktop\//, /lifecycle-demo-video\.spec\.ts$/],
    },
    {
      name: "live",
      testMatch: /-live\.spec\.ts$/,
      grep: /@live/,
    },
    // Dedicated VIDEO-DEMO lane. Records the full anton-grid submission →
    // update lifecycle to test-results/ with on-screen captions. Runs only
    // when explicitly selected (`--project=demo`); the default lane ignores it.
    {
      name: "demo",
      testMatch: /lifecycle-demo-video\.spec\.ts$/,
    },
    {
      name: "desktop",
      testDir: "e2e/desktop",
      testMatch: /.*\.spec\.ts$/,
    },
  ],
  webServer: RUN_LIVE ? [...baseWebServers, liveWebServer, liveStudioServer] : baseWebServers,
});
