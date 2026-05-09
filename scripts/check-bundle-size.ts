#!/usr/bin/env tsx
/**
 * T-048 — Bundle size CI assertion.
 *
 * Enforces the ADR-0674-04 budget for the Skill Studio bundle:
 *   • Initial JS chunk (`dist/eval-ui/assets/index-*.js`)  ≤ 250 KB gzipped
 *   • Fonts chunk       (`dist/eval-ui/assets/fonts-*.css`) ≤  70 KB gzipped
 *   • Lazy chunks       (CommandPalette, ShortcutModal) split → each ≤ 150 KB
 *     gzipped. Matched heuristically by filename (any chunk NOT matching
 *     `index-*` or `fonts-*`).
 *
 * Run AFTER `npm run build:eval-ui`. This module is also consumed by
 * `src/eval-ui/src/__tests__/bundle-size.test.ts` which re-exports the
 * pure-function core (`summarizeAssets`, `evaluateBudget`) so the logic is
 * unit-testable without a build.
 */
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Budgets — see ADR-0674-04. Values in bytes (gzipped).
// ---------------------------------------------------------------------------
export const BUDGET_INITIAL_JS_GZIPPED = 250 * 1024; // 250 KB
export const BUDGET_FONTS_GZIPPED = 70 * 1024; //  70 KB
export const BUDGET_LAZY_CHUNK_GZIPPED = 150 * 1024; // 150 KB per lazy chunk

export interface AssetEntry {
  /** Relative file name inside the assets dir. */
  name: string;
  /** Raw byte size. */
  size: number;
  /** gzip-compressed byte size. */
  gzipSize: number;
}

export interface BundleSummary {
  initialJs: AssetEntry | null;
  fonts: AssetEntry[];
  lazyJs: AssetEntry[];
  other: AssetEntry[];
}

export interface BudgetViolation {
  file: string;
  kind: "initial-js" | "fonts" | "lazy-js";
  gzipSize: number;
  budget: number;
}

export function isInitialJs(name: string): boolean {
  // Vite defaults: `index-<hash>.js` is the app entry chunk. Some configs
  // (including the eval-ui build after the 0834 surface additions) emit
  // `main-<hash>.js` instead — recognise both as the initial chunk.
  return /^(index|main)-[A-Za-z0-9_-]+\.js$/.test(name);
}

export function isFontsAsset(name: string): boolean {
  // `fonts-*` covers both the manualChunks-produced JS shim (if any) and the
  // CSS bundle Vite emits when `@fontsource-variable/*` packages are pulled
  // into a named chunk.
  return /^fonts-[A-Za-z0-9_-]+\.(js|css)$/.test(name);
}

export function isLazyJs(name: string): boolean {
  // A lazy JS chunk is any *.js that is NOT the initial entry and NOT a
  // fonts chunk. Vite names them by source module or hashed id.
  return name.endsWith(".js") && !isInitialJs(name) && !isFontsAsset(name);
}

export function summarizeAssets(entries: AssetEntry[]): BundleSummary {
  const summary: BundleSummary = {
    initialJs: null,
    fonts: [],
    lazyJs: [],
    other: [],
  };
  for (const e of entries) {
    if (isInitialJs(e.name)) {
      summary.initialJs = e;
    } else if (isFontsAsset(e.name)) {
      summary.fonts.push(e);
    } else if (isLazyJs(e.name)) {
      summary.lazyJs.push(e);
    } else {
      summary.other.push(e);
    }
  }
  return summary;
}

export function evaluateBudget(summary: BundleSummary): BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  if (summary.initialJs && summary.initialJs.gzipSize > BUDGET_INITIAL_JS_GZIPPED) {
    violations.push({
      file: summary.initialJs.name,
      kind: "initial-js",
      gzipSize: summary.initialJs.gzipSize,
      budget: BUDGET_INITIAL_JS_GZIPPED,
    });
  }
  const fontsTotal = summary.fonts.reduce((acc, f) => acc + f.gzipSize, 0);
  if (fontsTotal > BUDGET_FONTS_GZIPPED) {
    violations.push({
      file: summary.fonts.map((f) => f.name).join(", ") || "(fonts)",
      kind: "fonts",
      gzipSize: fontsTotal,
      budget: BUDGET_FONTS_GZIPPED,
    });
  }
  for (const lazy of summary.lazyJs) {
    if (lazy.gzipSize > BUDGET_LAZY_CHUNK_GZIPPED) {
      violations.push({
        file: lazy.name,
        kind: "lazy-js",
        gzipSize: lazy.gzipSize,
        budget: BUDGET_LAZY_CHUNK_GZIPPED,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// I/O helpers — kept out of pure core so tests can unit the math.
// ---------------------------------------------------------------------------
export async function readAssetsDir(assetsDir: string): Promise<AssetEntry[]> {
  const names = await fs.readdir(assetsDir);
  const out: AssetEntry[] = [];
  for (const name of names) {
    const full = path.join(assetsDir, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    // Only compress asset kinds that impact load budget; woff2 is
    // pre-compressed so its "gzipped" size is ~= raw size (measuring raw is
    // fine and matches what the browser downloads).
    const buf = await fs.readFile(full);
    const gzipSize = buf.length < 1_000_000 ? gzipSync(buf).byteLength : buf.length;
    out.push({ name, size: buf.length, gzipSize });
  }
  return out;
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(1) + " KB";
}

function printSummary(summary: BundleSummary) {
  const row = (label: string, entry: AssetEntry | null, budget: number | null) => {
    if (!entry) return `  ${label.padEnd(18)} — (missing)`;
    const gz = formatKB(entry.gzipSize).padStart(9);
    const bd = budget == null ? "" : `  / budget ${formatKB(budget)}`;
    return `  ${label.padEnd(18)} ${gz} gzipped (${formatKB(entry.size)} raw)${bd}`;
  };
  console.log("Bundle size summary");
  console.log(row("initial JS", summary.initialJs, BUDGET_INITIAL_JS_GZIPPED));
  if (summary.fonts.length === 0) {
    console.log("  fonts             — (no fonts-* chunk detected)");
  } else {
    const total = summary.fonts.reduce((a, f) => a + f.gzipSize, 0);
    console.log(
      `  fonts             ${formatKB(total).padStart(9)} gzipped across ${summary.fonts.length} file(s)  / budget ${formatKB(BUDGET_FONTS_GZIPPED)}`,
    );
    for (const f of summary.fonts) {
      console.log(`      · ${f.name} — ${formatKB(f.gzipSize)} gz`);
    }
  }
  if (summary.lazyJs.length > 0) {
    console.log(`  lazy JS           ${summary.lazyJs.length} chunk(s)  / per-chunk budget ${formatKB(BUDGET_LAZY_CHUNK_GZIPPED)}`);
    for (const l of summary.lazyJs) {
      console.log(`      · ${l.name} — ${formatKB(l.gzipSize)} gz`);
    }
  }
}

async function main() {
  const assetsDir = path.resolve(__dirname, "..", "dist", "eval-ui", "assets");
  try {
    await fs.access(assetsDir);
  } catch {
    console.error(
      `bundle-size check: assets dir not found at ${assetsDir}. Run 'npm run build:eval-ui' first.`,
    );
    process.exit(2);
  }

  const entries = await readAssetsDir(assetsDir);
  const summary = summarizeAssets(entries);
  printSummary(summary);

  const violations = evaluateBudget(summary);
  if (violations.length === 0) {
    console.log("\nbundle-size check: OK (all budgets met)");
    return;
  }

  console.error("\nbundle-size check: FAIL");
  for (const v of violations) {
    console.error(
      `  ${v.kind}: ${v.file} — ${formatKB(v.gzipSize)} > budget ${formatKB(v.budget)}`,
    );
  }
  process.exit(1);
}

// Only execute when invoked as a CLI. When imported by vitest the module
// must not run the IIFE (otherwise the test process exits).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(3);
  });
}
