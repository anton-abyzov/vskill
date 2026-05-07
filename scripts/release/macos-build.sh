#!/usr/bin/env bash
# macos-build.sh — Build a universal2 vSkill .dmg locally.
#
# Usage:
#   scripts/release/macos-build.sh [--notarize] [--smoke]
#
# Modes:
#   default   Build only (no notarize). Useful for local QA.
#   --smoke   Build only AND run notarize-macos.sh in --dry-run mode against
#             the produced artifact, to exercise the script-wiring without
#             consuming Apple notary quota. Used by pre-release CI.
#   --notarize  Build AND submit a real notarization request. ONLY use this
#               on release tags or when explicitly testing the notarize path.
#
# This script must run from the vskill repo root or the Tauri repo root that
# contains src-tauri/. It auto-detects which one it lives in.

set -euo pipefail

MODE="default"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)    MODE="smoke" ;;
    --notarize) MODE="notarize" ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d "src-tauri" ]]; then
  echo "ERROR: expected to find src-tauri/ under $REPO_ROOT" >&2
  exit 1
fi

# Universal2 needs both arch toolchains.
echo "==> Verifying rustup targets…"
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -q "^${target}$"; then
    echo "    Adding missing target: $target"
    rustup target add "$target"
  fi
done

echo "==> Building Tauri app (target: universal-apple-darwin)…"
if command -v cargo-tauri >/dev/null 2>&1; then
  TAURI_CMD="cargo tauri"
elif npx --no -- @tauri-apps/cli --version >/dev/null 2>&1; then
  TAURI_CMD="npx --no @tauri-apps/cli"
else
  echo "ERROR: neither cargo-tauri nor @tauri-apps/cli found" >&2
  exit 1
fi

# shellcheck disable=SC2086
$TAURI_CMD build --target universal-apple-darwin

DMG_PATH="$(ls -1t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"
APP_PATH="$(ls -1td src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app 2>/dev/null | head -1 || true)"

if [[ -z "$DMG_PATH" ]]; then
  echo "ERROR: no .dmg produced under src-tauri/target/universal-apple-darwin/release/bundle/dmg/" >&2
  exit 1
fi

echo "==> Built artifacts:"
echo "    .dmg: $DMG_PATH"
[[ -n "$APP_PATH" ]] && echo "    .app: $APP_PATH"

# Quick architecture sanity-check (verifies lipo merge succeeded).
if [[ -n "$APP_PATH" ]]; then
  BIN_PATH="$APP_PATH/Contents/MacOS/$(basename "$APP_PATH" .app)"
  if [[ -e "$BIN_PATH" ]]; then
    echo "==> Architecture check (expect both arm64 + x86_64):"
    lipo -info "$BIN_PATH" || true
  fi
fi

case "$MODE" in
  smoke)
    echo "==> Smoke: invoking notarize-macos.sh --dry-run"
    "$SCRIPT_DIR/notarize-macos.sh" "$DMG_PATH" --dry-run
    ;;
  notarize)
    echo "==> Submitting real notarization request"
    "$SCRIPT_DIR/notarize-macos.sh" "$DMG_PATH"
    ;;
  default)
    echo "==> Build complete (no notarization). Re-run with --notarize for a release build."
    ;;
esac

echo "==> macos-build.sh done. Final .dmg: $DMG_PATH"
