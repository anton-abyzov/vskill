#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# sign-linux-artifacts.sh -- GPG-sign vSkill Linux artifacts + SHA256SUMS.
#
# Owned by 0829 Track C (AC-US12-01..05). Invoked by the desktop-release-linux
# CI job after linux-build.sh succeeds. Per ADR 0829-02:
#
#   1. Compute SHA256SUMS over .deb / .rpm / .AppImage in the bundle dir.
#   2. Detached-armored sign each artifact with the project GPG key.
#   3. Detached-armored sign the SHA256SUMS aggregate file.
#
# Required env (set by CI from GitHub Actions secrets):
#   GPG_KEY_FPR        -- fingerprint of the signing subkey (long form, no spaces).
#                          Used as --local-user. Example:
#                          ABCD1234EF567890ABCD1234EF567890ABCD1234
#   GPG_PASSPHRASE     -- passphrase for the imported secret key. Read on
#                          stdin via --passphrase-fd 0 + --pinentry-mode loopback
#                          so unattended CI signing works.
#
# Pre-condition: the GPG private key is already imported into the runner's
# keyring (ci-pipeline-agent owns the import step, which decodes
# secrets.GPG_PRIVATE_KEY and runs `gpg --batch --import`).
#
# Usage:
#   GPG_KEY_FPR=... GPG_PASSPHRASE=... bash scripts/release/sign-linux-artifacts.sh
#   GPG_KEY_FPR=... bash scripts/release/sign-linux-artifacts.sh /path/to/bundle
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUNDLE_DIR="${1:-$ROOT_DIR/src-tauri/target/release/bundle}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "sign-linux-artifacts.sh: bundle dir not found: $BUNDLE_DIR" >&2
  exit 1
fi

if [ -z "${GPG_KEY_FPR:-}" ]; then
  echo "sign-linux-artifacts.sh: GPG_KEY_FPR is required" >&2
  exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "sign-linux-artifacts.sh: gpg is not installed on this runner" >&2
  exit 1
fi

# Verify the signing key is actually in the keyring before doing N signatures.
if ! gpg --list-secret-keys "$GPG_KEY_FPR" >/dev/null 2>&1; then
  echo "sign-linux-artifacts.sh: secret key $GPG_KEY_FPR not in keyring (was --import skipped?)" >&2
  exit 1
fi

# Reusable signing wrapper. Loopback pinentry + passphrase from $GPG_PASSPHRASE
# (if set) makes this safe for unattended runs.
gpg_sign() {
  local input="$1"
  if [ -n "${GPG_PASSPHRASE:-}" ]; then
    printf '%s' "$GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
      --passphrase-fd 0 --local-user "$GPG_KEY_FPR" \
      --detach-sign --armor "$input"
  else
    gpg --batch --yes --local-user "$GPG_KEY_FPR" \
      --detach-sign --armor "$input"
  fi
}

cd "$BUNDLE_DIR"

# --- 1. Per-artifact detached signatures -------------------------------------
echo "==> Per-artifact GPG signatures"
SIGNED_ANY=0
for pattern in "deb/*.deb" "rpm/*.rpm" "appimage/*.AppImage"; do
  for f in $pattern; do
    [ -f "$f" ] || continue
    SIGNED_ANY=1
    echo "    sign: $f"
    gpg_sign "$f"
    [ -f "$f.asc" ] || { echo "sign-linux-artifacts.sh: $f.asc not produced" >&2; exit 1; }
  done
done
if [ "$SIGNED_ANY" = "0" ]; then
  echo "sign-linux-artifacts.sh: no artifacts found under deb/, rpm/, appimage/" >&2
  exit 1
fi

# --- 2. SHA256SUMS aggregate + signature -------------------------------------
echo "==> Computing SHA256SUMS"
# Order: deb, rpm, appimage — alphabetical inside each. shopt -s nullglob is
# only needed if a class is empty, but we already asserted at least one match.
SHA_LINES=""
for pattern in "deb/*.deb" "rpm/*.rpm" "appimage/*.AppImage"; do
  for f in $pattern; do
    [ -f "$f" ] || continue
    # sha256sum prints "<hash>  <path>"; we keep the path relative to BUNDLE_DIR
    # so users can `cd bundle && sha256sum -c SHA256SUMS` after download.
    SHA_LINES+="$(sha256sum "$f")"$'\n'
  done
done
printf '%s' "$SHA_LINES" > SHA256SUMS

echo "==> Signing SHA256SUMS"
gpg_sign SHA256SUMS
[ -f "SHA256SUMS.asc" ] || { echo "sign-linux-artifacts.sh: SHA256SUMS.asc not produced" >&2; exit 1; }

echo "==> Signed artifacts in $BUNDLE_DIR:"
find . -maxdepth 3 \( -name "*.asc" -o -name "SHA256SUMS" \) -type f -print | sort
