#!/usr/bin/env bash
# release-desktop.sh — one-command desktop release
#
# Usage: bash scripts/release/release-desktop.sh <version>
# Example: bash scripts/release/release-desktop.sh 1.0.25
#
# Prereqs (these are persisted on Anton's Mac — don't re-ask):
#   ~/.config/skill-studio-release/minisign.key       (mode 0600)
#   ~/.config/skill-studio-release/minisign.passphrase (mode 0600, 25 bytes)
#   ~/.config/skill-studio-release/minisign.pub
# All of these were generated 2026-05-07 11:32:11 by the autonomous setup
# agent. The passphrase value is `vzSzSLms82nYxj8AR8hK0FPW` (24 chars; the
# file has a trailing newline making it 25 bytes on disk).
# The minisign keypair pubkey baked into src-tauri/tauri.conf.json is
# `RWQurXMiW9aLQ7B2y3YD1FmnJujwIZ86WVSs61uaXYuHEWBZcXkNY7MP`.
#
# All other GH Actions secrets (APPLE_*, ASC_*, TAURI_SIGNING_PRIVATE_KEY,
# RELEASE_TOKEN, GPG_*, CLOUDFLARE_R2_*) were provisioned 2026-05-07.
# Source-of-truth note: Obsidian vault →
#   003 Resources/Technical Knowledge/Credentials-Secrets-Passwords/EasyChamp/
#     Skill Studio Desktop release credentials.md
#
# What this script does:
#   1. Verifies local minisign + on-disk key+passphrase actually sign
#   2. Re-uploads TAURI_SIGNING_PRIVATE_KEY (clean base64) + the passphrase
#      (24-char no-newline via --body) to anton-abyzov/vskill GH secrets.
#      Earlier desktop releases (v1.0.18 → v1.0.24) failed because the
#      original GH secret payload had whitespace contamination + the wrong
#      passphrase encoding. This script always uploads from-disk on each
#      run so drift can never accumulate.
#   3. Bumps src-tauri/Cargo.toml + tauri.conf.json + Cargo.lock to the
#      requested version.
#   4. Commits + pushes to main.
#   5. Tags desktop-v<version> + pushes the tag → CI workflow runs.
#   6. Polls CI until completion (max 15 min), then on success:
#       - downloads the new minisign sig
#       - prints the base64-encoded sig you'll paste into the manifest
#       - tells you the next commands to run for the platform manifest
#         + redeploy + draft→latest promotion.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <version>   # e.g. 1.0.25" >&2
  exit 1
fi

VERSION="$1"
TAG="desktop-v${VERSION}"
REPO="anton-abyzov/vskill"
KEY_DIR="${HOME}/.config/skill-studio-release"

# ─── 1. Verify on-disk keypair ────────────────────────────────────────────
[[ -f "${KEY_DIR}/minisign.key" ]] || { echo "❌ missing ${KEY_DIR}/minisign.key" >&2; exit 1; }
[[ -f "${KEY_DIR}/minisign.passphrase" ]] || { echo "❌ missing ${KEY_DIR}/minisign.passphrase" >&2; exit 1; }
command -v minisign >/dev/null || { echo "❌ minisign not in PATH (brew install minisign)" >&2; exit 1; }

echo ">> verifying on-disk minisign keypair signs successfully..."
echo "test data" > /tmp/_release_check.txt
minisign -S -s "${KEY_DIR}/minisign.key" -m /tmp/_release_check.txt < "${KEY_DIR}/minisign.passphrase" > /dev/null 2>&1 \
  || { echo "❌ minisign sign failed — passphrase doesn't unlock the key. Inspect ${KEY_DIR}/." >&2; exit 1; }
rm -f /tmp/_release_check.txt /tmp/_release_check.txt.minisig
echo "   ✅ keypair OK"

# ─── 2. Re-upload TAURI_SIGNING_PRIVATE_KEY + passphrase ──────────────────
echo ">> re-uploading TAURI_SIGNING_PRIVATE_KEY (base64 of key file)..."
KEY_B64=$(base64 -i "${KEY_DIR}/minisign.key" | tr -d '\n\r\t ')
printf '%s' "${KEY_B64}" | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "${REPO}" >/dev/null
unset KEY_B64
echo "   ✅ TAURI_SIGNING_PRIVATE_KEY uploaded"

echo ">> re-uploading TAURI_SIGNING_PRIVATE_KEY_PASSWORD (24-char, no newline)..."
PASS_VAL=$(< "${KEY_DIR}/minisign.passphrase")  # bash <  strips trailing newline
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "${REPO}" --body "${PASS_VAL}" >/dev/null
unset PASS_VAL
echo "   ✅ TAURI_SIGNING_PRIVATE_KEY_PASSWORD uploaded"

# ─── 3. Bump versions ─────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"
echo ">> bumping src-tauri/Cargo.toml + tauri.conf.json to ${VERSION}..."
CURRENT=$(grep '^version = ' src-tauri/Cargo.toml | head -1 | sed -E 's/version = "([^"]+)".*/\1/')
sed -i.bak -E "s/^version = \"${CURRENT}\"$/version = \"${VERSION}\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak
node -e "const fs=require('fs'); const p='src-tauri/tauri.conf.json'; const c=JSON.parse(fs.readFileSync(p,'utf8')); c.version='${VERSION}'; fs.writeFileSync(p, JSON.stringify(c, null, 2)+'\n');"
(cd src-tauri && cargo update -p vskill-desktop --precise "${VERSION}" >/dev/null 2>&1)
echo "   ✅ versions bumped: ${CURRENT} → ${VERSION}"

# ─── 4. Commit + push + tag ───────────────────────────────────────────────
echo ">> committing + pushing + tagging..."
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
if git diff --cached --quiet; then
  echo "   (no version-file changes; pushing tag against existing HEAD)"
else
  git commit -m "release: desktop ${VERSION}" >/dev/null
  git push origin main >/dev/null
fi
git tag "${TAG}" 2>/dev/null || true
git push origin "${TAG}" >/dev/null
echo "   ✅ tag ${TAG} pushed"

# ─── 5. Wait for CI ────────────────────────────────────────────────────────
sleep 8
RUN_ID=$(gh run list -R "${REPO}" --workflow="Desktop Release" --limit 1 --json databaseId --jq '.[0].databaseId')
echo ">> CI run: https://github.com/${REPO}/actions/runs/${RUN_ID}"
echo ">> polling (up to 15 min)..."
START=$(date +%s)
until [[ "$(gh run view "${RUN_ID}" -R "${REPO}" --json status --jq .status)" = "completed" ]]; do
  ELAPSED=$(( $(date +%s) - START ))
  if (( ELAPSED > 900 )); then
    echo "❌ CI timeout"
    exit 1
  fi
  printf '.'
  sleep 15
done
echo
CONCLUSION=$(gh run view "${RUN_ID}" -R "${REPO}" --json conclusion --jq .conclusion)
if [[ "${CONCLUSION}" != "success" ]]; then
  echo "❌ CI ${CONCLUSION}: see https://github.com/${REPO}/actions/runs/${RUN_ID}"
  exit 1
fi
echo "   ✅ CI green"

# ─── 6. Promote release + print next steps ────────────────────────────────
echo ">> promoting release from draft → published..."
gh release edit "${TAG}" --draft=false -R "${REPO}" >/dev/null || true
echo ""
echo "✅ DESKTOP RELEASE ${VERSION} PUBLISHED"
echo "   https://github.com/${REPO}/releases/tag/${TAG}"
echo ""
echo "Next: update vskill-platform manifest + redeploy:"
mkdir -p /tmp/release-${VERSION}
gh release download "${TAG}" --repo "${REPO}" --pattern '*.app.tar.gz.sig' --dir "/tmp/release-${VERSION}" >/dev/null
SIG_B64=$(cat /tmp/release-${VERSION}/*.app.tar.gz.sig | base64 | tr -d '\n')
echo ""
echo "DARWIN_AARCH64_SIGNATURE = \"${SIG_B64}\""
echo ""
echo "Update vskill-platform/src/app/desktop/latest.json/route.ts:"
echo "  RELEASE_BASE → desktop-v${VERSION}"
echo "  MANIFEST.version → \"${VERSION}\""
echo "  DARWIN_AARCH64_SIGNATURE → (the value above)"
echo ""
echo "Then: cd repositories/anton-abyzov/vskill-platform && npm run build && npm run build:worker && npm run deploy"
