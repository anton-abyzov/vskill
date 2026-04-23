/**
 * T-048 — Bundle size unit tests.
 *
 * The expensive part (running `vite build` and measuring real gzipped output)
 * lives behind `npm run test:bundle-size`. This vitest suite only exercises
 * the pure-function core so the budget logic is locked in by CI.
 *
 * When a real `dist/eval-ui/assets` directory already exists from a prior
 * build, one live smoke-test also runs — it asserts the budget function
 * returns an array and does not throw. The full-pipeline assertion is in the
 * CLI script consumed by the `test:bundle-size` npm script.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  BUDGET_FONTS_GZIPPED,
  BUDGET_INITIAL_JS_GZIPPED,
  BUDGET_LAZY_CHUNK_GZIPPED,
  evaluateBudget,
  isFontsAsset,
  isInitialJs,
  isLazyJs,
  readAssetsDir,
  summarizeAssets,
  type AssetEntry,
} from "../../../../scripts/check-bundle-size";

describe("bundle-size — chunk classification", () => {
  it("classifies initial entry as index-<hash>.js", () => {
    expect(isInitialJs("index-Y-u_qHe2.js")).toBe(true);
    expect(isInitialJs("index.js")).toBe(false);
    expect(isInitialJs("fonts-abc.js")).toBe(false);
  });

  it("classifies fonts-* as fonts chunk (js or css)", () => {
    expect(isFontsAsset("fonts-i7Lkz2zN.css")).toBe(true);
    expect(isFontsAsset("fonts-abc123.js")).toBe(true);
    expect(isFontsAsset("index-abc.js")).toBe(false);
  });

  it("classifies other .js chunks as lazy", () => {
    expect(isLazyJs("mergeEvalChanges-Dpbbs4d4.js")).toBe(true);
    expect(isLazyJs("index-abc.js")).toBe(false);
    expect(isLazyJs("fonts-abc.js")).toBe(false);
    expect(isLazyJs("styles.css")).toBe(false);
  });
});

describe("bundle-size — summarizeAssets()", () => {
  it("partitions entries into initial / fonts / lazy / other", () => {
    const entries: AssetEntry[] = [
      { name: "index-abc.js", size: 500_000, gzipSize: 120_000 },
      { name: "fonts-xyz.css", size: 10_000, gzipSize: 3_000 },
      { name: "CommandPalette-hash.js", size: 300_000, gzipSize: 90_000 },
      { name: "index-abc.css", size: 100_000, gzipSize: 30_000 },
      { name: "inter-tight.woff2", size: 44_000, gzipSize: 44_000 },
    ];
    const s = summarizeAssets(entries);
    expect(s.initialJs?.name).toBe("index-abc.js");
    expect(s.fonts.map((f) => f.name)).toEqual(["fonts-xyz.css"]);
    expect(s.lazyJs.map((l) => l.name)).toEqual(["CommandPalette-hash.js"]);
    // index-*.css + woff2 land in "other"
    expect(s.other.map((o) => o.name).sort()).toEqual([
      "index-abc.css",
      "inter-tight.woff2",
    ]);
  });
});

describe("bundle-size — evaluateBudget()", () => {
  it("returns no violations when all assets are within budget", () => {
    const entries: AssetEntry[] = [
      { name: "index-abc.js", size: 500_000, gzipSize: 120_000 },
      { name: "fonts-xyz.css", size: 10_000, gzipSize: 3_000 },
      { name: "CommandPalette-hash.js", size: 300_000, gzipSize: 90_000 },
    ];
    const violations = evaluateBudget(summarizeAssets(entries));
    expect(violations).toEqual([]);
  });

  it("flags initial JS chunk over budget", () => {
    const entries: AssetEntry[] = [
      {
        name: "index-abc.js",
        size: 2_000_000,
        gzipSize: BUDGET_INITIAL_JS_GZIPPED + 1,
      },
    ];
    const violations = evaluateBudget(summarizeAssets(entries));
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("initial-js");
    expect(violations[0].budget).toBe(BUDGET_INITIAL_JS_GZIPPED);
  });

  it("flags fonts chunk over budget (summed across files)", () => {
    const half = Math.ceil(BUDGET_FONTS_GZIPPED / 2);
    const entries: AssetEntry[] = [
      // Initial JS intentionally under budget
      { name: "index-ok.js", size: 100_000, gzipSize: 50_000 },
      { name: "fonts-a.css", size: 20_000, gzipSize: half + 100 },
      { name: "fonts-b.js", size: 20_000, gzipSize: half + 100 },
    ];
    const violations = evaluateBudget(summarizeAssets(entries));
    expect(violations.some((v) => v.kind === "fonts")).toBe(true);
  });

  it("flags a lazy chunk larger than per-chunk budget", () => {
    const entries: AssetEntry[] = [
      { name: "index-ok.js", size: 100_000, gzipSize: 50_000 },
      {
        name: "MonsterChunk-abc.js",
        size: 800_000,
        gzipSize: BUDGET_LAZY_CHUNK_GZIPPED + 1,
      },
    ];
    const violations = evaluateBudget(summarizeAssets(entries));
    expect(violations.some((v) => v.kind === "lazy-js")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Optional smoke-run against any pre-existing dist/. This keeps vitest fast
// (we don't invoke `vite build`) but still surfaces real build results when
// they exist. `npm run test:bundle-size` runs the full check via the CLI.
// ---------------------------------------------------------------------------
const distAssetsDir = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "dist",
  "eval-ui",
  "assets",
);

describe.skipIf(!fsExistsSync(distAssetsDir))(
  "bundle-size — smoke check against existing dist/",
  () => {
    it("current build is within budget", async () => {
      const entries = await readAssetsDir(distAssetsDir);
      const summary = summarizeAssets(entries);
      const violations = evaluateBudget(summary);
      if (violations.length > 0) {
        // eslint-disable-next-line no-console
        console.error("bundle-size violations:", violations);
      }
      expect(violations).toEqual([]);
      // Sanity: the initial JS chunk must exist for the shell to boot.
      expect(summary.initialJs).not.toBeNull();
    });
  },
);

function fsExistsSync(p: string): boolean {
  try {
    // Node's fs.statSync throws if missing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").statSync(p);
    return true;
  } catch {
    return false;
  }
}
