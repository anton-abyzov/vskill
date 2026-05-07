#!/usr/bin/env bash
# Reproducibility script for the v1.0.12 desktop update signature.
#
# Background: the v1.0.12 GitHub Release shipped without .sig peer files
# because tauri-action's release upload step had releaseDraft=true (see
# desktop-release.yml). The macOS update bundle is hosted on the GH Release
# but the signature for Tauri's updater lives only in
# vskill-platform/src/app/desktop/latest.json/route.ts.
#
# This script regenerates the same base64 signature blob from the same
# bundle, so anyone with access to ~/.config/skill-studio-release/minisign.key
# can verify the value committed to the route handler.
#
# Usage:
#   bash scripts/release/sign-bundle-v1.0.12.sh
#
# Requires:
#   - minisign (brew install minisign)
#   - ~/.config/skill-studio-release/minisign.key
#   - ~/.config/skill-studio-release/minisign.passphrase
#
# Output: prints the base64-encoded .minisig content (single line, no \n).
#         This is exactly what goes into the `signature` field of latest.json.

set -euo pipefail

KEY="${HOME}/.config/skill-studio-release/minisign.key"
PASS_FILE="${HOME}/.config/skill-studio-release/minisign.passphrase"
PUB="${HOME}/.config/skill-studio-release/minisign.pub"
BUNDLE_URL="https://github.com/anton-abyzov/vskill/releases/download/desktop-v1.0.12/Skill.Studio_aarch64.app.tar.gz"
TMPDIR_USE="$(mktemp -d -t skill-studio-sign)"
trap 'rm -rf "$TMPDIR_USE"' EXIT

if [[ ! -f "$KEY" ]] || [[ ! -f "$PASS_FILE" ]]; then
  echo "ERROR: missing minisign key or passphrase under ~/.config/skill-studio-release/" >&2
  exit 1
fi

cd "$TMPDIR_USE"
echo "==> Downloading bundle..."
curl -fsSL "$BUNDLE_URL" -o Skill.Studio_aarch64.app.tar.gz

echo "==> Signing with minisign..."
PASS="$(cat "$PASS_FILE")"
minisign -S \
  -s "$KEY" \
  -m Skill.Studio_aarch64.app.tar.gz \
  -t "Skill Studio v1.0.12 update bundle (darwin-aarch64)" \
  <<<"$PASS" >/dev/null

echo "==> Verifying signature against pubkey..."
minisign -V -p "$PUB" -m Skill.Studio_aarch64.app.tar.gz >/dev/null
echo "    OK — signature verifies."

echo "==> Tauri-format signature (base64 of .minisig file):"
SIG_BASE64="$(base64 -i Skill.Studio_aarch64.app.tar.gz.minisig | tr -d '\n')"
echo "$SIG_BASE64"
