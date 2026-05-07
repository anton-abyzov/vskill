#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-sidecar.sh -- Build the vskill-server sidecar as a single Mach-O
# executable per macOS arch, ready to be embedded as Tauri externalBin.
#
# Owned by 0828 (vskill desktop app, sidecar bundling agent).
#
# Strategy:
#   1. Build the upstream artifacts (`npm run build` + `npm run build:eval-ui`)
#      so dist/eval-server and dist/eval-ui are fresh.
#   2. esbuild bundles scripts/desktop/sidecar-entry.mjs + the entire
#      eval-server module graph into a single CJS file, written to
#      dist/sidecar/server.cjs. We use CJS because Node 22 SEA officially
#      supports CJS `main` only (ESM SEA is still flagged experimental).
#   3. Generate dist/sidecar/eval-ui-manifest.json: a list of every file in
#      dist/eval-ui/ keyed by relative path. The wrapper reads this manifest
#      from a SEA asset and patches fs primitives so the eval-server's
#      static-file serving reads embedded blobs instead of disk.
#   4. Generate the SEA config (sea-config.json) referencing the bundle, the
#      manifest, every individual eval-ui file, and the version asset.
#   5. node --experimental-sea-config produces sea-prep.blob.
#   6. Copy the host node binary to src-tauri/binaries/vskill-server-${TRIPLE},
#      strip its signature (codesign --remove-signature), inject the blob via
#      postject, and re-ad-hoc-sign so macOS will execute it.
#
# Usage:
#   bash scripts/desktop/build-sidecar.sh                   # host arch
#   TARGET_TRIPLE=x86_64-apple-darwin bash ...              # explicit cross
#
# Cross-arch caveat: this script can ONLY produce a binary for an arch whose
# `node` interpreter is available locally. To produce both arm64 and x64, run
# the script on each arch (or under `arch -x86_64` with an x64 node installed).
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts/desktop"
SIDECAR_DIR="$ROOT_DIR/dist/sidecar"
BIN_DIR="$ROOT_DIR/src-tauri/binaries"

cd "$ROOT_DIR"

# --- 0. Resolve target triple --------------------------------------------------
HOST_ARCH=$(uname -m)
HOST_OS=$(uname -s)
case "$HOST_OS" in
  Darwin) HOST_OS_TRIPLE="apple-darwin" ;;
  *) echo "build-sidecar.sh: only macOS hosts supported (got $HOST_OS)" >&2; exit 1 ;;
esac
case "$HOST_ARCH" in
  arm64)  HOST_ARCH_TRIPLE="aarch64" ;;
  x86_64) HOST_ARCH_TRIPLE="x86_64" ;;
  *) echo "build-sidecar.sh: unsupported host arch $HOST_ARCH" >&2; exit 1 ;;
esac
TARGET_TRIPLE="${TARGET_TRIPLE:-${HOST_ARCH_TRIPLE}-${HOST_OS_TRIPLE}}"

# Sanity check: target arch must match the local node's arch since SEA injects
# into the host node binary. We can't cross-compile without a foreign node.
NODE_ARCH=$(node -p 'process.arch')
case "$TARGET_TRIPLE" in
  aarch64-apple-darwin) WANT_NODE_ARCH=arm64 ;;
  x86_64-apple-darwin)  WANT_NODE_ARCH=x64 ;;
  *) echo "build-sidecar.sh: unsupported target triple $TARGET_TRIPLE" >&2; exit 1 ;;
esac
if [ "$NODE_ARCH" != "$WANT_NODE_ARCH" ]; then
  echo "build-sidecar.sh: node arch $NODE_ARCH cannot produce $TARGET_TRIPLE binary" >&2
  echo "  (re-run under \`arch -$WANT_NODE_ARCH\` with a matching node, or build on that host)" >&2
  exit 2
fi

OUT_BIN="$BIN_DIR/vskill-server-${TARGET_TRIPLE}"
echo "==> Target: $TARGET_TRIPLE → $OUT_BIN"

# --- 1. Upstream build ---------------------------------------------------------
if [ "${SKIP_UPSTREAM_BUILD:-0}" != "1" ]; then
  echo "==> Building upstream artifacts (tsc + vite)..."
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    echo "build-sidecar.sh: node_modules missing — run \`npm install\` first" >&2
    exit 1
  fi
  npm run build >/dev/null
  npm run build:eval-ui >/dev/null
fi
[ -f "$ROOT_DIR/dist/eval-server/eval-server.js" ] || {
  echo "build-sidecar.sh: dist/eval-server/eval-server.js missing — upstream build failed" >&2; exit 1; }
[ -f "$ROOT_DIR/dist/eval-ui/index.html" ] || {
  echo "build-sidecar.sh: dist/eval-ui/index.html missing — upstream build failed" >&2; exit 1; }

# --- 2. esbuild bundle ---------------------------------------------------------
mkdir -p "$SIDECAR_DIR"
echo "==> Bundling sidecar-entry.mjs → dist/sidecar/server.cjs (esbuild CJS)"

# `--external:node:*` keeps native protocol requires intact. We mark
# `@napi-rs/keyring` external because it is a lazy darwin-only dep behind a
# function-scope `require()` (dist/lib/keychain.js); it fires only if the
# user invokes platform/GitHub features, never at startup. Bundling its
# .node binding into SEA is non-trivial and out of scope for v1 — the gap
# is documented in scripts/desktop/README.md.
# Banner injects a __sea_import_meta_url helper so any code that was compiled
# against `import.meta.url` (eval-server.ts and friends) can be retargeted by
# define to that helper, which derives a proper file:// URL from CJS
# `__filename`. This is what esbuild calls the "fake import.meta" pattern for
# CJS-bundled ESM source.
read -r -d '' BANNER_JS <<'JS' || true
const __sea_pathToFileURL = (() => {
  try { return require('node:url').pathToFileURL; } catch { return null; }
})();
const __sea_import_meta_url = (() => {
  try { return __sea_pathToFileURL ? __sea_pathToFileURL(__filename).href : ('file://' + __filename); }
  catch { return 'file://' + __filename; }
})();
JS

"$ROOT_DIR/node_modules/.bin/esbuild" \
  "$SCRIPT_DIR/sidecar-entry.mjs" \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --outfile="$SIDECAR_DIR/server.cjs" \
  --external:@napi-rs/keyring \
  --external:@napi-rs/keyring-* \
  --define:import.meta.url=__sea_import_meta_url \
  --define:import.meta.dirname=__dirname \
  --define:import.meta.filename=__filename \
  --banner:js="$BANNER_JS" \
  --legal-comments=none \
  --log-level=warning

BUNDLE_SIZE=$(wc -c < "$SIDECAR_DIR/server.cjs" | tr -d ' ')
echo "    bundle size: $((BUNDLE_SIZE / 1024)) KiB"

# --- 3. Generate eval-ui manifest + version asset -----------------------------
echo "==> Generating eval-ui manifest"
node --input-type=module -e "
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = '$ROOT_DIR/dist/eval-ui';
const out = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.isFile()) out.push(relative(root, p).split('\\\\').join('/'));
  }
}
walk(root);
const manifest = Object.fromEntries(out.map((rel) => [rel, true]));
writeFileSync('$SIDECAR_DIR/eval-ui-manifest.json', JSON.stringify(manifest));
console.error('   ' + out.length + ' eval-ui files indexed');
"

VSKILL_VERSION=$(node -p 'require("./package.json").version')
printf '%s' "$VSKILL_VERSION" > "$SIDECAR_DIR/vskill-version.txt"
echo "    vskill version: $VSKILL_VERSION"

# --- 4. Generate sea-config.json ----------------------------------------------
echo "==> Generating sea-config.json"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('$SIDECAR_DIR/eval-ui-manifest.json', 'utf8'));
const assets = {
  'eval-ui-manifest.json': '$SIDECAR_DIR/eval-ui-manifest.json',
  'vskill-version.txt':    '$SIDECAR_DIR/vskill-version.txt',
};
for (const rel of Object.keys(manifest)) {
  assets['eval-ui/' + rel] = '$ROOT_DIR/dist/eval-ui/' + rel;
}
const cfg = {
  main: '$SIDECAR_DIR/server.cjs',
  output: '$SIDECAR_DIR/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
writeFileSync('$SIDECAR_DIR/sea-config.json', JSON.stringify(cfg, null, 2));
console.error('   sea-config.json written ('+Object.keys(assets).length+' assets)');
"

# --- 5. Build SEA blob ---------------------------------------------------------
echo "==> Building SEA blob"
node --experimental-sea-config "$SIDECAR_DIR/sea-config.json" 2>&1 \
  | grep -v "ExperimentalWarning" \
  | grep -v "Use \`node --trace-warnings" \
  || true
[ -f "$SIDECAR_DIR/sea-prep.blob" ] || {
  echo "build-sidecar.sh: sea-prep.blob missing — SEA build failed" >&2
  exit 1
}
BLOB_SIZE=$(wc -c < "$SIDECAR_DIR/sea-prep.blob" | tr -d ' ')
echo "    SEA blob: $((BLOB_SIZE / 1024)) KiB"

# --- 6. Copy node, inject blob, ad-hoc sign -----------------------------------
NODE_BIN=$(command -v node)
mkdir -p "$BIN_DIR"
echo "==> Copying $NODE_BIN → $OUT_BIN"
cp -f "$NODE_BIN" "$OUT_BIN"
chmod +w "$OUT_BIN"

# Strip existing signature so postject can rewrite the binary. macOS SIPs
# refuse to load a binary whose hash mismatches its embedded signature.
echo "==> Stripping codesign"
codesign --remove-signature "$OUT_BIN" 2>/dev/null || true

# Resolve postject. It's a transitive dep of vite/rollup tooling sometimes,
# but most likely we need to run via npx with --yes for a one-off install.
echo "==> Injecting SEA blob via postject"
if [ -x "$ROOT_DIR/node_modules/.bin/postject" ]; then
  POSTJECT="$ROOT_DIR/node_modules/.bin/postject"
else
  # `npx --yes postject@latest` fetches it on demand; pin to a known-good
  # version to keep builds reproducible.
  POSTJECT="npx --yes postject@1.0.0-alpha.6"
fi

$POSTJECT "$OUT_BIN" NODE_SEA_BLOB "$SIDECAR_DIR/sea-prep.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Re-ad-hoc-sign so macOS will load the binary. Distribution builds will
# replace this with a Developer-ID signature later in the Tauri pipeline.
echo "==> Re-signing (ad-hoc)"
codesign --sign - "$OUT_BIN"

OUT_SIZE=$(wc -c < "$OUT_BIN" | tr -d ' ')
echo "==> Done: $OUT_BIN ($((OUT_SIZE / 1024 / 1024)) MiB)"
