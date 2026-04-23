#!/usr/bin/env node

// Preflight wrapper for the vskill CLI.
//
// If someone runs `npx vskill` (or `bunx vskill`) from inside an unbuilt source
// checkout, npm/bun resolves the local package and runs this bin directly. The
// real index.js imports `commander`, which fails with a cryptic
// ERR_MODULE_NOT_FOUND if `node_modules/` was never populated.
//
// This wrapper detects that case and prints a clear, actionable error before
// any static ESM imports run.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const hasCommander = existsSync(resolve(repoRoot, "node_modules", "commander"));
const looksLikeSourceCheckout = existsSync(resolve(repoRoot, "src", "index.ts"));

if (!hasCommander && looksLikeSourceCheckout) {
  process.stderr.write(
    "\nvskill: runtime dependencies are not installed in this source checkout.\n" +
      `  path: ${repoRoot}\n\n` +
      "  You are running the local source copy, not the published package.\n" +
      "  Install deps, then retry:\n\n" +
      `    cd ${repoRoot}\n` +
      "    npm install       # or: bun install / pnpm install / yarn install\n\n" +
      "  To use the published CLI instead of this checkout, run from a directory\n" +
      "  outside the vskill repo (e.g. cd ~ && npx vskill ...).\n\n",
  );
  process.exit(1);
}

await import("./index.js");
