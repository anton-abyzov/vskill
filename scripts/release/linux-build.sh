#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# linux-build.sh -- Build vSkill .deb / .rpm / .AppImage on ubuntu-22.04.
#
# Owned by 0829 Track C. Invoked by the `desktop-release-linux` job in
# .github/workflows/desktop-release.yml (managed by ci-pipeline-agent).
#
# Pre-flight installs the Tauri 2 Linux build deps + `rpm` (Tauri's RPM
# bundler shells out to rpmbuild from the host). The `cargo tauri build`
# invocation produces all three artifacts in one shot per ADR 0829-02.
#
# Usage (CI):
#   bash scripts/release/linux-build.sh
#
# Usage (local Linux dev — Ubuntu 22.04+ recommended):
#   SKIP_DEPS=1 bash scripts/release/linux-build.sh   # if deps already installed
#
# Outputs (relative to vskill repo root):
#   src-tauri/target/release/bundle/deb/*.deb
#   src-tauri/target/release/bundle/rpm/*.rpm
#   src-tauri/target/release/bundle/appimage/*.AppImage
# Each emitted absolute path is echoed at the end.
#
# Note: This script will fail on macOS (cargo tauri build can't produce
# Linux bundles on Darwin). It must run on a Linux x86_64 host.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# --- 0. OS sanity --------------------------------------------------------------
HOST_OS=$(uname -s)
if [ "$HOST_OS" != "Linux" ]; then
  echo "linux-build.sh: must run on Linux (got $HOST_OS)" >&2
  exit 1
fi
HOST_ARCH=$(uname -m)
if [ "$HOST_ARCH" != "x86_64" ]; then
  echo "linux-build.sh: only x86_64 supported in v1 (got $HOST_ARCH)" >&2
  exit 1
fi

# --- 1. Install build deps -----------------------------------------------------
if [ "${SKIP_DEPS:-0}" != "1" ]; then
  echo "==> Installing Linux build dependencies (ADR 0829-02 §6.2)"
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    build-essential \
    curl wget file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libgtk-3-dev \
    patchelf \
    libfuse2 \
    rpm
fi

# --- 2. Sidecar -----------------------------------------------------------------
# Build the Linux SEA sidecar before Tauri picks it up. tauri.conf.json's
# bundle.externalBin reference resolves to a per-target-triple file; without
# this step Tauri will fail with "binaries/vskill-server-x86_64-unknown-linux-gnu
# not found".
echo "==> Building Linux sidecar"
bash "$ROOT_DIR/scripts/desktop/build-sidecar-linux.sh"

# --- 3. Tauri build ------------------------------------------------------------
echo "==> cargo tauri build"
cd "$ROOT_DIR"
# Tauri picks up bundle.targets from tauri.conf.json. With ["app", "dmg", "deb",
# "rpm", "appimage"], it will skip the macOS-only targets on Linux and produce
# all three Linux formats. No --bundles flag needed.
if [ -x "$ROOT_DIR/node_modules/.bin/tauri" ]; then
  "$ROOT_DIR/node_modules/.bin/tauri" build
else
  npx --yes @tauri-apps/cli@latest build
fi

# --- 4. Locate artifacts -------------------------------------------------------
BUNDLE_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
DEB_FILE=$(find "$BUNDLE_DIR/deb" -maxdepth 1 -name "*.deb" -type f 2>/dev/null | head -1 || true)
RPM_FILE=$(find "$BUNDLE_DIR/rpm" -maxdepth 1 -name "*.rpm" -type f 2>/dev/null | head -1 || true)
APPIMAGE_FILE=$(find "$BUNDLE_DIR/appimage" -maxdepth 1 -name "*.AppImage" -type f 2>/dev/null | head -1 || true)

MISSING=0
if [ -z "$DEB_FILE" ]; then
  echo "linux-build.sh: .deb artifact not found in $BUNDLE_DIR/deb" >&2
  MISSING=1
fi
if [ -z "$RPM_FILE" ]; then
  echo "linux-build.sh: .rpm artifact not found in $BUNDLE_DIR/rpm" >&2
  MISSING=1
fi
if [ -z "$APPIMAGE_FILE" ]; then
  echo "linux-build.sh: .AppImage artifact not found in $BUNDLE_DIR/appimage" >&2
  MISSING=1
fi
[ "$MISSING" = "1" ] && exit 1

# --- 5. AppImage size budget (≤90 MB per AC-US11-04 / NFR-11) ------------------
APPIMAGE_SIZE=$(stat -c%s "$APPIMAGE_FILE")
APPIMAGE_LIMIT=$((90 * 1024 * 1024))
if [ "$APPIMAGE_SIZE" -gt "$APPIMAGE_LIMIT" ]; then
  echo "linux-build.sh: AppImage size $APPIMAGE_SIZE exceeds 90 MB budget ($APPIMAGE_LIMIT)" >&2
  exit 1
fi

echo "==> Linux artifacts:"
echo "    DEB:      $DEB_FILE"
echo "    RPM:      $RPM_FILE"
echo "    APPIMAGE: $APPIMAGE_FILE ($((APPIMAGE_SIZE / 1024 / 1024)) MiB)"
