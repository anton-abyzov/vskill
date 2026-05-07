#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-sidecar-linux.sh -- Build the vskill-server sidecar as a single
# Linux ELF executable per arch, ready to be embedded as Tauri externalBin.
#
# Owned by 0829 (Track C — Linux distribution).
#
# Mirror of scripts/desktop/build-sidecar.sh (macOS) with these differences:
#   - HOST_OS_TRIPLE = unknown-linux-gnu
#   - x86_64 only for v1 (Tauri's ubuntu-22.04 GitHub Actions runner is amd64;
#     aarch64 Linux build is out of scope for 0829 — the architect deferred
#     it to a future increment).
#   - No codesign / postject re-sign; on Linux, postject leaves a runnable
#     ELF and the GPG signing happens later in scripts/release/sign-linux-artifacts.sh.
#   - File-mode bookkeeping: ensure 0755 on the output binary.
#
# Required apt packages on Ubuntu 22.04 before running:
#   sudo apt-get install -y build-essential libssl-dev
#
# Node 22+ is required (SEA uses --experimental-sea-config which is only
# documented since Node 22). On the GitHub `ubuntu-22.04` runner, install
# Node 22 via `actions/setup-node@v4` with `node-version: 22` before invoking
# this script.
#
# Usage:
#   bash scripts/desktop/build-sidecar-linux.sh
#
# Cross-arch caveat: same as macOS — SEA injects into the host node binary,
# so the script can only produce an x86_64 ELF when run on x86_64 Linux.
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
  Linux) HOST_OS_TRIPLE="unknown-linux-gnu" ;;
  *) echo "build-sidecar-linux.sh: only Linux hosts supported (got $HOST_OS)" >&2; exit 1 ;;
esac
case "$HOST_ARCH" in
  x86_64) HOST_ARCH_TRIPLE="x86_64" ;;
  aarch64)
    echo "build-sidecar-linux.sh: aarch64 Linux is out of scope for 0829 (deferred)" >&2
    exit 1
    ;;
  *) echo "build-sidecar-linux.sh: unsupported host arch $HOST_ARCH" >&2; exit 1 ;;
esac
TARGET_TRIPLE="${TARGET_TRIPLE:-${HOST_ARCH_TRIPLE}-${HOST_OS_TRIPLE}}"

NODE_ARCH=$(node -p 'process.arch')
case "$TARGET_TRIPLE" in
  x86_64-unknown-linux-gnu) WANT_NODE_ARCH=x64 ;;
  *) echo "build-sidecar-linux.sh: unsupported target triple $TARGET_TRIPLE" >&2; exit 1 ;;
esac
if [ "$NODE_ARCH" != "$WANT_NODE_ARCH" ]; then
  echo "build-sidecar-linux.sh: node arch $NODE_ARCH cannot produce $TARGET_TRIPLE binary" >&2
  exit 2
fi

OUT_BIN="$BIN_DIR/vskill-server-${TARGET_TRIPLE}"
echo "==> Target: $TARGET_TRIPLE → $OUT_BIN"

# --- 1. Upstream build ---------------------------------------------------------
if [ "${SKIP_UPSTREAM_BUILD:-0}" != "1" ]; then
  echo "==> Building upstream artifacts (tsc + vite)..."
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    echo "build-sidecar-linux.sh: node_modules missing — run \`npm install\` first" >&2
    exit 1
  fi
  npm run build >/dev/null
  npm run build:eval-ui >/dev/null
fi
[ -f "$ROOT_DIR/dist/eval-server/eval-server.js" ] || {
  echo "build-sidecar-linux.sh: dist/eval-server/eval-server.js missing — upstream build failed" >&2; exit 1; }
[ -f "$ROOT_DIR/dist/eval-ui/index.html" ] || {
  echo "build-sidecar-linux.sh: dist/eval-ui/index.html missing — upstream build failed" >&2; exit 1; }

# --- 2. esbuild bundle ---------------------------------------------------------
mkdir -p "$SIDECAR_DIR"
echo "==> Bundling sidecar-entry.mjs → dist/sidecar/server.cjs (esbuild CJS)"

# Same banner / define / external set as macOS — sidecar entry is platform-agnostic.
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
  echo "build-sidecar-linux.sh: sea-prep.blob missing — SEA build failed" >&2
  exit 1
}
BLOB_SIZE=$(wc -c < "$SIDECAR_DIR/sea-prep.blob" | tr -d ' ')
echo "    SEA blob: $((BLOB_SIZE / 1024)) KiB"

# --- 6. Copy node, inject blob ------------------------------------------------
NODE_BIN=$(command -v node)
mkdir -p "$BIN_DIR"
echo "==> Copying $NODE_BIN → $OUT_BIN"
cp -f "$NODE_BIN" "$OUT_BIN"
chmod +w "$OUT_BIN"

echo "==> Injecting SEA blob via postject"
if [ -x "$ROOT_DIR/node_modules/.bin/postject" ]; then
  POSTJECT="$ROOT_DIR/node_modules/.bin/postject"
else
  POSTJECT="npx --yes postject@1.0.0-alpha.6"
fi

# Linux ELF injection: no codesign, no macho-segment-name. The sentinel fuse
# tells SEA where to find the blob inside the ELF rodata section.
$POSTJECT "$OUT_BIN" NODE_SEA_BLOB "$SIDECAR_DIR/sea-prep.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Make sure Tauri's externalBin runner can exec it.
chmod 0755 "$OUT_BIN"

OUT_SIZE=$(wc -c < "$OUT_BIN" | tr -d ' ')
echo "==> Done: $OUT_BIN ($((OUT_SIZE / 1024 / 1024)) MiB)"
