import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // test/verify/** is a node:test suite (run via `npm run verify:matrix`),
    // not a vitest suite — collecting it reddens every `npm test`.
    exclude: ["node_modules", "dist", "e2e", "test/verify/**"],
    // Keep GitHub auth out of the suite: a token in the developer's shell or a
    // signed-in `gh` would route raw reads through the Contents API and change
    // the URLs tests assert on. Tests that need a token stub one explicitly.
    env: {
      VSKILL_NO_GH_CLI: "1",
      // Never read or write the developer's remembered-public repo file.
      VSKILL_VISIBILITY_CACHE: "0",
      VSKILL_GITHUB_TOKEN: "",
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
    },
  },
});
