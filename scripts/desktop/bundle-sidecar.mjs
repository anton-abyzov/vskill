#!/usr/bin/env node
// ---------------------------------------------------------------------------
// bundle-sidecar.mjs -- esbuild the Tauri sidecar entry into a single CJS file.
//
// Single source of truth for the bundling step shared by build-sidecar.sh
// (macOS), build-sidecar-linux.sh and build-sidecar-windows.ps1.
//
// Why a JS-API script instead of the esbuild CLI: the 7-line `--banner:js`
// prologue below cannot be passed as one argv entry through
// node_modules\.bin\esbuild.cmd on Windows -- cmd.exe cuts the argument at the
// first newline, which left the Windows bundle with a half prologue
// (`const __sea_pathToFileURL = (() => {`) that fails to parse at SEA startup
// ("sidecar exited before announcing port"). Calling `esbuild.build()` from
// Node removes the shell from the path entirely.
//
// After bundling the script (1) asserts the prologue is intact and (2) runs
// `node --check` on the output, so a broken bundle fails the build instead of
// the first user launch.
//
// Usage:
//   node scripts/desktop/bundle-sidecar.mjs [--outfile dist/sidecar/server.cjs]
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENTRY_FILE = path.join(ROOT_DIR, "scripts", "desktop", "sidecar-entry.mjs");
export const DEFAULT_OUTFILE = path.join(ROOT_DIR, "dist", "sidecar", "server.cjs");

// Prologue injected ahead of the bundle. Any code compiled against
// `import.meta.url` (eval-server.ts and friends) is retargeted by `define` to
// `__sea_import_meta_url`, which derives a proper file:// URL from the CJS
// `__filename` -- esbuild's "fake import.meta" pattern for CJS-bundled ESM.
export const BANNER_JS = [
  "const __sea_pathToFileURL = (() => {",
  "  try { return require('node:url').pathToFileURL; } catch { return null; }",
  "})();",
  "const __sea_import_meta_url = (() => {",
  "  try { return __sea_pathToFileURL ? __sea_pathToFileURL(__filename).href : ('file://' + __filename); }",
  "  catch { return 'file://' + __filename; }",
  "})();",
].join("\n");

/** Substrings that must all appear near the top of a healthy bundle. */
export const PROLOGUE_MARKERS = [
  "const __sea_pathToFileURL = (() => {",
  "const __sea_import_meta_url = (() => {",
  "__sea_pathToFileURL(__filename).href",
];

/** esbuild options -- identical for every platform. */
export function buildOptions(outfile = DEFAULT_OUTFILE) {
  return {
    entryPoints: [ENTRY_FILE],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    // `@napi-rs/keyring` is a lazy darwin-only dep behind a function-scope
    // require(); it never fires at startup. Bundling its .node binding into
    // SEA is out of scope (see scripts/desktop/README.md).
    external: ["@napi-rs/keyring", "@napi-rs/keyring-*"],
    define: {
      "import.meta.url": "__sea_import_meta_url",
      "import.meta.dirname": "__dirname",
      "import.meta.filename": "__filename",
    },
    banner: { js: BANNER_JS },
    legalComments: "none",
    logLevel: "warning",
  };
}

/** Throws when the bundle head does not carry the full prologue. */
export function assertPrologue(source) {
  const head = source.slice(0, 2000);
  const missing = PROLOGUE_MARKERS.filter((m) => !head.includes(m));
  if (missing.length > 0) {
    throw new Error(
      `bundle prologue truncated or missing (${missing.join(", ")}); first 400 bytes:\n${head.slice(0, 400)}`,
    );
  }
}

/** `node --check <file>` -- syntax gate, throws on non-zero exit. */
export function nodeCheck(file) {
  const res = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`node --check failed for ${file} (exit ${res.status ?? res.signal})`);
  }
}

export async function bundleSidecar({ outfile = DEFAULT_OUTFILE } = {}) {
  if (!fs.existsSync(path.join(ROOT_DIR, "dist", "eval-server", "eval-server.js"))) {
    throw new Error("dist/eval-server/eval-server.js missing -- run `npm run build` first");
  }
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const esbuild = require("esbuild");
  await esbuild.build(buildOptions(outfile));
  assertPrologue(fs.readFileSync(outfile, "utf8"));
  nodeCheck(outfile);
  return { outfile, bytes: fs.statSync(outfile).size };
}

function parseArgs(argv) {
  const out = { outfile: DEFAULT_OUTFILE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--outfile" && argv[i + 1]) {
      out.outfile = path.resolve(argv[++i]);
    }
  }
  return out;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  bundleSidecar(parseArgs(process.argv.slice(2)))
    .then(({ outfile, bytes }) => {
      console.log(`    bundle: ${path.relative(ROOT_DIR, outfile)} (${Math.round(bytes / 1024)} KiB, prologue OK, node --check OK)`);
    })
    .catch((err) => {
      console.error(`bundle-sidecar: ${err && err.message ? err.message : err}`);
      process.exit(1);
    });
}
