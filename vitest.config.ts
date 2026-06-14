import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // test/verify/** is a node:test suite (run via `npm run verify:matrix`),
    // not a vitest suite — collecting it reddens every `npm test`.
    exclude: ["node_modules", "dist", "e2e", "test/verify/**"],
  },
});
