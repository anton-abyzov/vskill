#!/usr/bin/env bash
# update-brew-cask.sh — Generate or update the Casks/vskill.rb file for the
# Homebrew tap. Per plan §4.6, the first 2-3 releases ship to the staging tap
# (verified-skill/homebrew-tap-staging). After 100+ successful installs OR
# 7 days clean, mainline submission via `brew bump-cask-pr` is manual.
#
# Usage:
#   scripts/release/update-brew-cask.sh \
#     --version <X.Y.Z> \
#     --url <https://...vskill-X.Y.Z-universal.dmg> \
#     --sha256 <sha256-of-dmg> \
#     [--tap-dir <local-tap-clone>] \
#     [--target staging|mainline]
#
# If --tap-dir is omitted, the generated Casks/vskill.rb is written to stdout
# so a CI workflow can pipe it into the tap repo's working copy.

set -euo pipefail

VERSION=""
URL=""
SHA256=""
TAP_DIR=""
TARGET="staging"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --url)     URL="$2"; shift 2 ;;
    --sha256)  SHA256="$2"; shift 2 ;;
    --tap-dir) TAP_DIR="$2"; shift 2 ;;
    --target)  TARGET="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,25p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$VERSION" || -z "$URL" || -z "$SHA256" ]]; then
  echo "ERROR: --version, --url, --sha256 are required" >&2
  exit 1
fi

case "$TARGET" in
  staging|mainline) : ;;
  *) echo "ERROR: --target must be 'staging' or 'mainline'" >&2; exit 1 ;;
esac

# Derive cask body. Uses HEREDOC with interpolation; do NOT switch to a
# 'EOF' quoted heredoc — version/url/sha need to be substituted now.
read -r -d '' CASK_BODY <<EOF || true
cask "vskill" do
  version "${VERSION}"
  sha256 "${SHA256}"

  url "${URL}"
  name "Skill Studio"
  desc "Verified AI skill marketplace and studio (desktop)"
  homepage "https://verified-skill.com"

  auto_updates true
  depends_on macos: ">= :ventura"

  app "Skill Studio.app"

  zap trash: [
    "~/.vskill",
    "~/Library/Logs/vSkill",
    "~/Library/Caches/com.verifiedskill.desktop",
    "~/Library/Preferences/com.verifiedskill.desktop.plist",
  ]
end
EOF

if [[ -n "$TAP_DIR" ]]; then
  if [[ ! -d "$TAP_DIR/Casks" ]]; then
    mkdir -p "$TAP_DIR/Casks"
  fi
  CASK_FILE="$TAP_DIR/Casks/vskill.rb"
  echo "==> Writing $CASK_FILE (target=$TARGET, version=$VERSION)"
  printf '%s\n' "$CASK_BODY" > "$CASK_FILE"
  echo "==> Wrote $(wc -l < "$CASK_FILE") lines"
  if [[ "$TARGET" == "mainline" ]]; then
    echo "==> NOTE: For mainline submission, run from a homebrew-cask checkout:"
    echo "         brew bump-cask-pr --version $VERSION vskill"
    echo "         (do NOT just commit Casks/vskill.rb to homebrew-cask)"
  fi
else
  printf '%s\n' "$CASK_BODY"
fi
