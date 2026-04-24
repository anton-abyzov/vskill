import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3077",
    headless: true,
  },
  webServer: {
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
});
