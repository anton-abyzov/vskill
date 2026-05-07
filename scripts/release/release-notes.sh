#!/usr/bin/env bash
# release-notes.sh — Generate Markdown release notes for a desktop-v* tag.
# Wraps git-cliff against ../.github/cliff.toml. Output goes to
#   ./RELEASE_NOTES.md  (consumed by softprops/action-gh-release)
#   stdout              (also printed for pipe-friendliness)
#
# Usage:
#   bash scripts/release/release-notes.sh                 # current HEAD tag
#   bash scripts/release/release-notes.sh desktop-v0.1.0  # explicit tag
#
# Requires: git-cliff (>= 2.0). CI installs via:
#   curl -L https://github.com/orhun/git-cliff/releases/latest/download/git-cliff-x86_64-unknown-linux-gnu.tar.gz \
#     | tar xz -C /tmp && sudo install /tmp/git-cliff*/git-cliff /usr/local/bin/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

TAG="${1:-${GITHUB_REF_NAME:-}}"
if [[ -z "$TAG" ]]; then
  TAG="$(git describe --tags --abbrev=0 --match='desktop-v*' 2>/dev/null || true)"
fi
if [[ -z "$TAG" ]]; then
  echo "ERROR: no desktop-v* tag found in this commit ancestry. Pass an explicit tag." >&2
  exit 1
fi

PREV="$(git describe --tags --abbrev=0 --match='desktop-v*' "${TAG}^" 2>/dev/null || true)"

if ! command -v git-cliff >/dev/null 2>&1; then
  echo "ERROR: git-cliff not installed. See header for install instructions." >&2
  exit 1
fi

CONFIG="$REPO_ROOT/.github/cliff.toml"

# Generate the body. --strip header drops the cliff.toml header (we set our own).
RANGE_ARG=()
if [[ -n "$PREV" ]]; then
  RANGE_ARG=("${PREV}..${TAG}")
fi

BODY="$(git-cliff --config "$CONFIG" "${RANGE_ARG[@]}" --tag "$TAG" --strip header)"

# Collect SHA256 of any artifacts already staged (CI publishes after build,
# so this is best-effort. If nothing yet, omit the section.)
CHECKSUMS=""
if compgen -G "release-artifacts/**/*" >/dev/null 2>&1; then
  CHECKSUMS=$(
    cd release-artifacts
    find . -type f \( -name "*.dmg" -o -name "*.msi" -o -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.tar.gz" \) \
      -exec sha256sum {} \;
  )
fi

DIFF_LINK=""
if [[ -n "$PREV" ]]; then
  DIFF_LINK="[Compare ${PREV}...${TAG}](https://github.com/anton-abyzov/vskill/compare/${PREV}...${TAG})"
else
  DIFF_LINK="[Browse ${TAG}](https://github.com/anton-abyzov/vskill/releases/tag/${TAG})"
fi

OUT="$REPO_ROOT/RELEASE_NOTES.md"
{
  printf '# Skill Studio %s\n\n' "${TAG#desktop-v}"
  printf '%s\n' "$BODY"
  if [[ -n "$CHECKSUMS" ]]; then
    printf '\n## Checksums (SHA-256)\n\n```\n%s\n```\n' "$CHECKSUMS"
  fi
  printf '\n## Diff\n\n%s\n' "$DIFF_LINK"
} > "$OUT"

cat "$OUT"
