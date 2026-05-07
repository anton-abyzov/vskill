#!/usr/bin/env bash
# notarize-macos.sh — Submit a signed .app or .dmg to Apple's notary service,
# wait for the result, staple the ticket, and verify with spctl.
#
# Usage:
#   scripts/release/notarize-macos.sh <path-to-.dmg-or-.app> [--dry-run]
#
# Requirements:
#   - xcrun notarytool keychain profile named "vskill" (already set up
#     per increment 0828 metadata; see scripts/release/macos-README.md
#     for re-creation instructions if the profile is missing).
#   - The artifact MUST already be signed with the Developer ID Application
#     identity. Notarization will reject unsigned binaries with an explicit
#     code-signing error.
#
# Exit codes:
#   0  success (notarized + stapled + spctl accepts)
#   1  invalid arguments
#   2  artifact missing or wrong file type
#   3  notarytool submission failed
#   4  stapler failed
#   5  spctl post-staple verification failed

set -euo pipefail

PROFILE="${ASC_KEYCHAIN_PROFILE:-vskill}"
DRY_RUN=0

print_usage() {
  echo "Usage: $0 <path-to-.dmg-or-.app> [--dry-run]" >&2
}

if [[ $# -lt 1 ]]; then
  print_usage
  exit 1
fi

ARTIFACT="$1"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) print_usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; print_usage; exit 1 ;;
  esac
  shift
done

if [[ ! -e "$ARTIFACT" ]]; then
  echo "ERROR: artifact not found: $ARTIFACT" >&2
  exit 2
fi

case "$ARTIFACT" in
  *.dmg|*.app|*.zip|*.pkg) : ;;
  *) echo "ERROR: artifact must be .dmg, .app, .zip, or .pkg (got: $ARTIFACT)" >&2; exit 2 ;;
esac

echo "==> Notarizing: $ARTIFACT"
echo "    Keychain profile: $PROFILE"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> [dry-run] Skipping xcrun notarytool submit + stapler + spctl"
  echo "==> [dry-run] Would invoke:"
  echo "      xcrun notarytool submit \"$ARTIFACT\" --keychain-profile \"$PROFILE\" --wait --output-format json"
  echo "      xcrun stapler staple \"$ARTIFACT\""
  echo "      spctl -a -vv \"$ARTIFACT\""
  exit 0
fi

# notarytool submit returns JSON we can parse for the submission ID + status.
SUBMIT_OUTPUT="$(xcrun notarytool submit "$ARTIFACT" \
  --keychain-profile "$PROFILE" \
  --wait \
  --output-format json 2>&1)" || {
  echo "ERROR: notarytool submit failed:"
  echo "$SUBMIT_OUTPUT"
  exit 3
}

echo "$SUBMIT_OUTPUT"

STATUS="$(echo "$SUBMIT_OUTPUT" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('status', ''))" 2>/dev/null || echo "")"
SUBMISSION_ID="$(echo "$SUBMIT_OUTPUT" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('id', ''))" 2>/dev/null || echo "")"

if [[ "$STATUS" != "Accepted" ]]; then
  echo "ERROR: notarization status: $STATUS (expected Accepted)" >&2
  if [[ -n "$SUBMISSION_ID" ]]; then
    echo "==> Fetching notarization log for submission $SUBMISSION_ID:"
    xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$PROFILE" || true
  fi
  exit 3
fi

echo "==> Notarization Accepted (submission $SUBMISSION_ID). Stapling…"
if ! xcrun stapler staple "$ARTIFACT"; then
  echo "ERROR: stapler failed" >&2
  exit 4
fi

echo "==> Verifying with spctl…"
if ! spctl -a -t exec -vv "$ARTIFACT" 2>&1 | tee /dev/stderr | grep -q "accepted"; then
  echo "ERROR: spctl rejected the stapled artifact" >&2
  exit 5
fi

echo "==> Notarized + stapled + spctl-accepted: $ARTIFACT"
