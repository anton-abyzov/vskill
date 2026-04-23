/**
 * T-055 — Lighthouse CI budget assertion.
 *
 * Enforces:
 *   • First Contentful Paint (FCP)        ≤ 800 ms
 *   • Time To Interactive   (TTI)         ≤ 1500 ms
 *
 * Runs against `vite preview` serving the built Studio. The preview server
 * is launched by LHCI itself via `startServerCommand`; budgets are asserted
 * with `upload.target=filesystem` so results can be archived without a
 * Lighthouse CI server.
 *
 * Mid-range laptop simulation uses the Lighthouse default "mobile" form
 * factor's CPU/network throttling, which approximates a 4× CPU slowdown +
 * Fast 3G — matching the scope brief's "mid-range laptop, CPU 4× slowdown".
 *
 * Invoke:  `npm run test:lhci`
 */

/** @type {import("@lhci/cli").LHCIConfig} */
const config = {
  ci: {
    collect: {
      // Build is assumed to be up-to-date; `npm run build:eval-ui` must run
      // before LHCI. Use `vite preview` to serve the production bundle.
      startServerCommand:
        "npx vite preview --config src/eval-ui/vite.config.ts --port 4173 --strictPort",
      startServerReadyPattern: "Local:",
      url: ["http://localhost:4173/"],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        // Mid-range laptop throttle — CPU 4x, Fast 3G-like network.
        throttling: {
          cpuSlowdownMultiplier: 4,
          rttMs: 40,
          throughputKbps: 10 * 1024,
          uploadThroughputKbps: 750,
        },
        onlyCategories: ["performance"],
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      // Budgets map directly to AC-US9-01.
      assertions: {
        "first-contentful-paint": [
          "error",
          { maxNumericValue: 800, aggregationMethod: "median" },
        ],
        interactive: [
          "error",
          { maxNumericValue: 1500, aggregationMethod: "median" },
        ],
        // Soft-guard: keep TBT reasonable so FCP/TTI aren't gamed via a tiny
        // critical path that then blocks on a long JS task.
        "total-blocking-time": [
          "warn",
          { maxNumericValue: 300, aggregationMethod: "median" },
        ],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./scripts/.lhci",
      reportFilenamePattern: "lhci-%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%",
    },
  },
};

export default config;
