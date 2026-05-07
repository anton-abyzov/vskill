#!/usr/bin/env bash
# publish-manifest.sh — Atomic publish of Skill Studio release artifacts +
# latest.json to Cloudflare R2 (bucket: vskill-desktop, custom domain:
# verified-skill.com/desktop/*). Implements ADR 0829-01 §3 atomic ordering.
#
# Usage:
#   bash scripts/release/publish-manifest.sh <version> <release-artifacts-dir>
#
#   <version>                e.g. 0.1.0  (NOT the desktop-v0.1.0 tag — strip the prefix)
#   <release-artifacts-dir>  Directory containing the per-OS artifact subfolders
#                            from actions/download-artifact:
#                              ./macos-14-artifacts/
#                              ./windows-2022-artifacts/
#                              ./ubuntu-22.04-artifacts/
#
# Required env:
#   CLOUDFLARE_R2_ACCOUNT_ID       — for the R2 endpoint URL
#   CLOUDFLARE_R2_ACCESS_KEY_ID    — R2 access key (S3-compat)
#   CLOUDFLARE_R2_SECRET_ACCESS_KEY
#
# Optional env:
#   STAGING=1     Publish to staging.json instead of latest.json (AC-US16-04).
#   DRY_RUN=1     Print all aws-cli commands without executing.
#
# Atomicity (ADR 0829-01 §3):
#   1. Upload binaries to v<VERSION>/<artifact>     — all platforms must succeed
#   2. Upload v<VERSION>/latest.json                — canonical history
#   3. Atomic copy: v<VERSION>/latest.json → /desktop/latest.json (R2 PUT is atomic)
#   4. Mirror to /desktop/history/v<VERSION>.json   — for rollback
#
# Cache-Control:
#   /desktop/latest.json           public, max-age=3600   (AC-US16-02 = 1h)
#   /desktop/staging.json          public, max-age=60     (faster iteration during E2E)
#   /desktop/v<VERSION>/*          public, max-age=2592000, immutable  (30d immutable)
#   /desktop/history/v<VERSION>.json  public, max-age=86400  (24h, mutable in emergencies)

set -euo pipefail

VERSION="${1:-}"
ARTIFACTS_DIR="${2:-}"

if [[ -z "$VERSION" || -z "$ARTIFACTS_DIR" ]]; then
  echo "Usage: $0 <version> <release-artifacts-dir>" >&2
  exit 2
fi

if [[ ! -d "$ARTIFACTS_DIR" ]]; then
  echo "ERROR: artifacts dir not found: $ARTIFACTS_DIR" >&2
  exit 2
fi

: "${CLOUDFLARE_R2_ACCOUNT_ID:?CLOUDFLARE_R2_ACCOUNT_ID not set}"
: "${CLOUDFLARE_R2_ACCESS_KEY_ID:?CLOUDFLARE_R2_ACCESS_KEY_ID not set}"
: "${CLOUDFLARE_R2_SECRET_ACCESS_KEY:?CLOUDFLARE_R2_SECRET_ACCESS_KEY not set}"

R2_ENDPOINT="https://${CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET="vskill-desktop"
DEST_PREFIX="desktop"
MANIFEST_NAME="latest.json"
if [[ "${STAGING:-0}" == "1" ]]; then
  MANIFEST_NAME="staging.json"
  echo "==> STAGING mode: publishing to ${MANIFEST_NAME}"
fi

DRY=""
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  DRY="echo [DRY-RUN]"
  echo "==> DRY_RUN=1 — no actual uploads"
fi

# Use AWS CLI in S3-compat mode against R2.
export AWS_ACCESS_KEY_ID="$CLOUDFLARE_R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$CLOUDFLARE_R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="auto"

aws_s3() { $DRY aws --endpoint-url "$R2_ENDPOINT" s3 "$@"; }
aws_s3api() { $DRY aws --endpoint-url "$R2_ENDPOINT" s3api "$@"; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---------------------------------------------------------------------------
# Step 0 — Pre-flight: verify aws-cli + connectivity
# ---------------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws-cli not installed. Install via 'pip install awscli' or apt." >&2
  exit 1
fi

if [[ -z "$DRY" ]]; then
  echo "==> Verifying R2 access ..."
  if ! aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://$BUCKET/" >/dev/null 2>&1; then
    echo "ERROR: cannot access s3://$BUCKET (check creds / endpoint / bucket existence)" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 1 — Discover artifacts + their .sig files
# ---------------------------------------------------------------------------
# Tauri Updater needs the `.tar.gz` (macOS), `.nsis.zip` or `.msi.zip` (Windows),
# `.AppImage.tar.gz` (Linux) — all sit alongside the user-facing `.dmg`/`.msi`/
# `.deb`/`.AppImage` produced by `cargo tauri build`. Each has a peer `.sig`
# file emitted by tauri-action.
#
# We expect the upload to mirror the bundle/<format>/ tree:
#   v<VERSION>/macos/vSkill_<v>_aarch64.dmg
#   v<VERSION>/macos/vSkill_<v>_aarch64.app.tar.gz
#   v<VERSION>/macos/vSkill_<v>_aarch64.app.tar.gz.sig
#   v<VERSION>/windows/vSkill_<v>_x64-setup.nsis.zip(.sig) etc.

declare -A PLATFORM_BUNDLE   # tauri platform key -> bundle filename (relative to artifacts/)
declare -A PLATFORM_SIG      # tauri platform key -> base64 sig (read from .sig file)

discover_platform() {
  local key="$1"; local pattern="$2"; local search_dir="$3"
  local bundle
  bundle="$(find "$search_dir" -type f -name "$pattern" 2>/dev/null | head -1 || true)"
  if [[ -z "$bundle" ]]; then
    echo "WARN: no $pattern found under $search_dir (skipping $key)" >&2
    return
  fi
  local sig="${bundle}.sig"
  if [[ ! -f "$sig" ]]; then
    echo "ERROR: missing signature file: $sig" >&2
    exit 1
  fi
  PLATFORM_BUNDLE["$key"]="$bundle"
  # tauri-action's .sig file is already the base64 minisign sig as a single line.
  PLATFORM_SIG["$key"]="$(tr -d '\n' < "$sig")"
}

# Search inside the artifacts dir — agents in build matrix uploaded with names
# like "macos-14-artifacts", "windows-2022-artifacts", "ubuntu-22.04-artifacts".
discover_platform "darwin-aarch64"   "*aarch64*.app.tar.gz"        "$ARTIFACTS_DIR"
discover_platform "darwin-x86_64"    "*x86_64*.app.tar.gz"         "$ARTIFACTS_DIR"
# If only a universal2 build is produced, both keys point at the same bundle.
if [[ -z "${PLATFORM_BUNDLE[darwin-aarch64]:-}" && -z "${PLATFORM_BUNDLE[darwin-x86_64]:-}" ]]; then
  discover_platform "darwin-aarch64" "*.app.tar.gz" "$ARTIFACTS_DIR"
  if [[ -n "${PLATFORM_BUNDLE[darwin-aarch64]:-}" ]]; then
    PLATFORM_BUNDLE["darwin-x86_64"]="${PLATFORM_BUNDLE[darwin-aarch64]}"
    PLATFORM_SIG["darwin-x86_64"]="${PLATFORM_SIG[darwin-aarch64]}"
  fi
fi
discover_platform "windows-x86_64"   "*x64-setup.nsis.zip"          "$ARTIFACTS_DIR" \
  || discover_platform "windows-x86_64"   "*.msi.zip"                "$ARTIFACTS_DIR"
discover_platform "linux-x86_64"     "*amd64.AppImage.tar.gz"       "$ARTIFACTS_DIR" \
  || discover_platform "linux-x86_64"     "*.AppImage.tar.gz"        "$ARTIFACTS_DIR"

if [[ ${#PLATFORM_BUNDLE[@]} -eq 0 ]]; then
  echo "ERROR: no platform bundles discovered under $ARTIFACTS_DIR" >&2
  exit 1
fi

echo "==> Discovered ${#PLATFORM_BUNDLE[@]} platform bundles:"
for key in "${!PLATFORM_BUNDLE[@]}"; do
  echo "    $key  →  ${PLATFORM_BUNDLE[$key]}"
done

# ---------------------------------------------------------------------------
# Step 2 — Upload binaries (per-version, immutable path)
# ---------------------------------------------------------------------------
# Upload BOTH the user-facing artifact (.dmg/.msi/.deb/.rpm/.AppImage) AND
# the Tauri update bundle (.tar.gz/.zip + .sig). The user-facing artifacts are
# what the website's download buttons link to; the update bundles are what
# Tauri Updater downloads.

VERSION_PREFIX="$DEST_PREFIX/v$VERSION"

upload_with_cache() {
  local src="$1"; local dest="$2"; local cache="$3"
  local content_type="${4:-application/octet-stream}"
  aws_s3 cp "$src" "s3://$BUCKET/$dest" \
    --cache-control "$cache" \
    --content-type "$content_type" \
    --no-progress
}

echo "==> Uploading user-facing artifacts to s3://$BUCKET/$VERSION_PREFIX/ ..."
while IFS= read -r f; do
  fname="$(basename "$f")"
  upload_with_cache "$f" "$VERSION_PREFIX/$fname" "public, max-age=2592000, immutable"
done < <(find "$ARTIFACTS_DIR" -type f \
  \( -name "*.dmg" -o -name "*.msi" -o -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" \))

echo "==> Uploading update bundles + .sig files ..."
for key in "${!PLATFORM_BUNDLE[@]}"; do
  bundle="${PLATFORM_BUNDLE[$key]}"
  fname="$(basename "$bundle")"
  upload_with_cache "$bundle" "$VERSION_PREFIX/$fname" "public, max-age=2592000, immutable"
  upload_with_cache "${bundle}.sig" "$VERSION_PREFIX/${fname}.sig" "public, max-age=2592000, immutable" "text/plain"
done

# ---------------------------------------------------------------------------
# Step 3 — Assemble latest.json
# ---------------------------------------------------------------------------
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NOTES_FILE="$REPO_ROOT/RELEASE_NOTES.md"
NOTES="Skill Studio $VERSION"
if [[ -f "$NOTES_FILE" ]]; then
  # Strip shell-unfriendly chars; first 5KB.
  NOTES="$(head -c 5120 "$NOTES_FILE")"
fi

MANIFEST="$(mktemp -t latest.XXXXXX.json)"
trap 'rm -f "$MANIFEST"' EXIT

# Build the platforms{} object via jq for proper escaping.
PLATFORMS_JSON='{}'
for key in "${!PLATFORM_BUNDLE[@]}"; do
  bundle="${PLATFORM_BUNDLE[$key]}"
  fname="$(basename "$bundle")"
  url="https://verified-skill.com/$VERSION_PREFIX/$fname"
  sig="${PLATFORM_SIG[$key]}"
  PLATFORMS_JSON="$(jq --arg k "$key" --arg s "$sig" --arg u "$url" \
    '. + {($k): {signature: $s, url: $u}}' <<<"$PLATFORMS_JSON")"
done

jq -n \
  --arg version "$VERSION" \
  --arg notes "$NOTES" \
  --arg pub_date "$PUB_DATE" \
  --argjson platforms "$PLATFORMS_JSON" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: $platforms}' \
  > "$MANIFEST"

echo "==> Generated manifest:"
jq . "$MANIFEST"

# ---------------------------------------------------------------------------
# Step 4 — Atomic publish: version path FIRST, then promote to latest.json,
#          then mirror to history/.
# ---------------------------------------------------------------------------
echo "==> Step 4a: Upload manifest to canonical version path ..."
upload_with_cache "$MANIFEST" "$VERSION_PREFIX/latest.json" "public, max-age=3600" "application/json"

echo "==> Step 4b: Promote to /$DEST_PREFIX/$MANIFEST_NAME (atomic) ..."
upload_with_cache "$MANIFEST" "$DEST_PREFIX/$MANIFEST_NAME" "public, max-age=3600" "application/json"

echo "==> Step 4c: Mirror to /$DEST_PREFIX/history/v$VERSION.json (rollback target) ..."
upload_with_cache "$MANIFEST" "$DEST_PREFIX/history/v$VERSION.json" "public, max-age=86400" "application/json"

# ---------------------------------------------------------------------------
# Step 5 — Verify post-publish (skip in dry-run)
# ---------------------------------------------------------------------------
if [[ -z "$DRY" ]]; then
  echo "==> Verifying upload via R2 listing ..."
  aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://$BUCKET/$VERSION_PREFIX/" | head -20
  aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://$BUCKET/$DEST_PREFIX/$MANIFEST_NAME"
fi

echo "==> Done. Manifest live at https://verified-skill.com/$DEST_PREFIX/$MANIFEST_NAME"
echo "    Version path:        https://verified-skill.com/$VERSION_PREFIX/"
echo "    Rollback target:     https://verified-skill.com/$DEST_PREFIX/history/v$VERSION.json"
