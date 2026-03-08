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
  },
});
