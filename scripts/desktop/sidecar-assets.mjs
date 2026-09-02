#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sidecar-assets.mjs -- generate the SEA side files next to server.cjs:
//   dist/sidecar/eval-ui-manifest.json  every dist/eval-ui file keyed by
//                                       forward-slash relative path
//   dist/sidecar/vskill-version.txt     package.json version
//   dist/sidecar/sea-config.json        Node SEA config referencing all of it
//
// Shared by build-sidecar.sh, build-sidecar-linux.sh and
// build-sidecar-windows.ps1 (previously each inlined the same two Node
// snippets). Paths are absolute so `node --experimental-sea-config` can be run
// from any cwd.
//
// Usage:
//   node scripts/desktop/sidecar-assets.mjs
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Recursively list files under `root` as forward-slash relative paths. */
export function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) out.push(path.relative(root, p).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/** Build the sea-config object (pure; no I/O). */
export function seaConfig({ sidecarDir, evalUiDir, manifest }) {
  const assets = {
    "eval-ui-manifest.json": path.join(sidecarDir, "eval-ui-manifest.json"),
    "vskill-version.txt": path.join(sidecarDir, "vskill-version.txt"),
  };
  for (const rel of Object.keys(manifest)) {
    assets[`eval-ui/${rel}`] = path.join(evalUiDir, ...rel.split("/"));
  }
  return {
    main: path.join(sidecarDir, "server.cjs"),
    output: path.join(sidecarDir, "sea-prep.blob"),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };
}

export function writeSidecarAssets({ rootDir = ROOT_DIR } = {}) {
  const sidecarDir = path.join(rootDir, "dist", "sidecar");
  const evalUiDir = path.join(rootDir, "dist", "eval-ui");
  if (!fs.existsSync(path.join(evalUiDir, "index.html"))) {
    throw new Error("dist/eval-ui/index.html missing -- run `npm run build:eval-ui` first");
  }
  fs.mkdirSync(sidecarDir, { recursive: true });

  const files = listFiles(evalUiDir);
  const manifest = Object.fromEntries(files.map((rel) => [rel, true]));
  fs.writeFileSync(path.join(sidecarDir, "eval-ui-manifest.json"), JSON.stringify(manifest));

  const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
  fs.writeFileSync(path.join(sidecarDir, "vskill-version.txt"), version);

  const cfg = seaConfig({ sidecarDir, evalUiDir, manifest });
  fs.writeFileSync(path.join(sidecarDir, "sea-config.json"), JSON.stringify(cfg, null, 2));

  return { files: files.length, version, assets: Object.keys(cfg.assets).length };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const r = writeSidecarAssets();
    console.log(`    ${r.files} eval-ui files indexed, version ${r.version}, sea-config.json (${r.assets} assets)`);
  } catch (err) {
    console.error(`sidecar-assets: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
}
