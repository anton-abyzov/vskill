#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Publish preflight — "would this tarball actually work?"
//
// Why this exists
// ---------------
// The repo's `.npmrc` sets `ignore-scripts=true` to stop DEPENDENCY install
// scripts (the July-2026 payload vector). npm's `ignore-scripts` is not scoped
// to dependencies: it also suppresses THIS package's own lifecycle hooks, so a
// bare `npm publish` silently skips `prepublishOnly` — no build, no eval-ui
// bundle, no README badge sync, no `git diff --exit-code` guard.
//
// `dist/` is gitignored, so on a fresh clone that failure mode is not "stale
// build" but "no build at all": `npm pack --dry-run` on this branch produced a
// 9.8 KB tarball with ZERO dist/ entries while `bin.vskill` points at
// ./dist/bin.js. npm publishes that without a warning (verified: a package
// whose `bin` target does not exist packs and publishes exit 0).
//
// This script is the assertion npm refuses to make. It inspects the tarball npm
// would actually upload — not the working tree — and fails if the entrypoints
// are missing or older than the sources they are built from.
//
// It runs from `prepublishOnly` (so it fires whenever hooks are enabled) and
// from `npm run release` (the documented hand-publish path, which forces hooks
// on with --ignore-scripts=false). Run it directly with `npm run release:preflight`.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const failures = [];
const fail = (msg) => failures.push(msg);

// --- 1. What would npm actually put in the tarball? ------------------------
// `npm pack --dry-run` writes nothing; it reports the exact entry list npm
// would upload, honouring `files`, .npmignore and npm's built-in rules.
let entries;
try {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, npm_config_ignore_scripts: "true" }, // no nested hooks
  });
  entries = new Set(JSON.parse(raw)[0].files.map((f) => f.path));
} catch (err) {
  console.error("[preflight] `npm pack --dry-run --json` failed:");
  console.error(err.stderr?.toString() ?? err.message);
  process.exit(1);
}

// --- 2. Every entrypoint the package declares must be IN that tarball ------
const entrypoints = [
  ...(pkg.main ? [pkg.main] : []),
  ...Object.values(pkg.bin ?? {}),
].map((p) => p.replace(/^\.\//, ""));

for (const ep of entrypoints) {
  if (!entries.has(ep)) {
    fail(
      `${ep} is declared in package.json (main/bin) but is NOT in the tarball — ` +
        "the build did not run. Publish with `npm run release`, never bare `npm publish`.",
    );
  }
}

// --- 3. The Studio UI bundle ships from dist/eval-ui -----------------------
// `build:eval-ui` is a separate vite build; `tsc` alone leaves it out and the
// desktop/studio surface then 404s at runtime instead of failing at publish.
if (![...entries].some((f) => f.startsWith("dist/eval-ui/"))) {
  fail(
    "dist/eval-ui/** is missing from the tarball — `npm run build:eval-ui` did not run.",
  );
}

// --- 4. Freshness: dist must not predate src -------------------------------
// Catches the other half of the hole: a dist/ left over from an older checkout.
function newestMtime(dir, filter = () => true) {
  let newest = 0;
  const walk = (d) => {
    let items;
    try {
      items = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) {
        if (item.name === "node_modules") continue;
        walk(full);
      } else if (filter(full)) {
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(dir);
  return newest;
}

const distDir = path.join(repoRoot, "dist");
const srcDir = path.join(repoRoot, "src");
const newestDist = newestMtime(distDir);
// Test files are not compiled into dist, so editing one must not read as stale.
const newestSrc = newestMtime(srcDir, (f) => !/\.(test|spec)\.[cm]?tsx?$/.test(f));

if (newestDist === 0) {
  fail("dist/ is empty or absent — run `npm run build && npm run build:eval-ui`.");
} else if (newestSrc > newestDist) {
  fail(
    "dist/ is older than src/ — the build output is stale. " +
      `newest src ${new Date(newestSrc).toISOString()} > newest dist ${new Date(newestDist).toISOString()}.`,
  );
}

// --- Report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error("[preflight] refusing to publish:\n");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nThe repo .npmrc sets ignore-scripts=true, which also suppresses this\n" +
      "package's own prepublishOnly hook. Use `npm run release` (it passes\n" +
      "--ignore-scripts=false) so the build actually runs before publishing.\n",
  );
  process.exit(1);
}

console.log(
  `[preflight] ok — tarball carries ${entries.size} entries including ${entrypoints.join(", ")} and dist/eval-ui/**`,
);
