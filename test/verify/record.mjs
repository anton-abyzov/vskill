#!/usr/bin/env node
// Anthropic-style recording ritual (video ~28:00).
// Headless chromium opens the verify dashboard, clicks "Run all", waits for the
// busy state to clear, and saves the entire interaction as a .webm in
// reports/recordings/.
//
// Usage: node scripts/record.mjs [http://127.0.0.1:5853/verify]

import { chromium } from "playwright";
import { mkdirSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 0857: recordings live beside the in-repo harness at <vskill>/test/verify/reports.
const VERIFY_DIR = resolve(__dirname, ".");
const REC_DIR = join(VERIFY_DIR, "reports", "recordings");
mkdirSync(REC_DIR, { recursive: true });

const URL = process.argv[2] || "http://127.0.0.1:5853/verify";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  recordVideo: { dir: REC_DIR, size: { width: 1200, height: 900 } },
});
const page = await context.newPage();

console.log(`→ opening ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded" });

// Make sure initial render is visible (give animations a moment).
await page.waitForSelector('[data-sw-verify-overall]', { timeout: 5000 });
await page.waitForTimeout(800);

console.log("→ clicking Run all");
await page.click('button#runAll');

// Wait for busy marker to clear.
await page.waitForFunction(() => {
  const el = document.querySelector('[data-sw-verify-busy]');
  return el && el.getAttribute("data-sw-verify-busy") === "false";
}, { timeout: 60000 });

// Show the result for a moment, expand all check panels, then close.
await page.waitForTimeout(700);
const toggles = await page.$$('.toggle-checks');
for (const t of toggles) { await t.click(); await page.waitForTimeout(120); }
await page.waitForTimeout(1500);

// Read the final verdict (will be printed for the run-log).
const overall = await page.getAttribute('[data-sw-verify-overall]', 'data-sw-verify-overall');
const lastRun = await page.textContent('#lastRun');
const unitCount = await page.getAttribute('[data-sw-verify-units-total]', 'data-sw-verify-units-total');

await context.close();
await browser.close();

// Playwright writes .webm with a random name. Rename to the stamp.
const files = readdirSync(REC_DIR).map((f) => ({ name: f, m: statSync(join(REC_DIR, f)).mtimeMs })).filter((f) => f.name.endsWith(".webm"));
files.sort((a, b) => b.m - a.m);
const newest = files[0];
const target = `run-${stamp}.webm`;
if (newest) {
  renameSync(join(REC_DIR, newest.name), join(REC_DIR, target));
  const meta = { runAt: new Date().toISOString(), verdict: overall, lastRun, unitCount, video: target };
  console.log("→ recorded:", join(REC_DIR, target));
  console.log("→ metadata:", JSON.stringify(meta, null, 2));
} else {
  console.error("no .webm produced — check that chromium has video codec support");
  process.exit(1);
}
