#!/usr/bin/env bash
# notarize-macos.sh — Submit a signed .app or .dmg to Apple's notary service,
# wait for the result, staple the ticket, and verify with spctl.
#
# Usage:
#   scripts/release/notarize-macos.sh <path-to-.dmg-or-.app> [--dry-run]
#
# Credentials (first match wins):
#   1. NOTARY_PROFILE (or the older ASC_KEYCHAIN_PROFILE): an xcrun notarytool
#      keychain profile.
#   2. APPLE_ID + APPLE_PASSWORD (app-specific password) + APPLE_TEAM_ID: the
#      same Apple ID credential tauri-action notarizes the .app with. CI
#      (desktop-release.yml, notarize-dryrun.yml) uses only this path.
#   3. Neither: the local keychain profile "vskill" (see
#      scripts/release/macos-README.md to re-create it).
#   Setting only some of the APPLE_* variables is an error.
#
# The artifact MUST already be signed with the Developer ID Application
# identity. Notarization rejects unsigned binaries with a code-signing error.
#
# Optional env:
#   NOTARY_WAIT_TIMEOUT  e.g. 30m — passed to `notarytool submit --timeout`.
#
# Exit codes:
#   0  success (notarized + stapled + spctl accepts as Notarized Developer ID)
#   1  invalid arguments or incomplete credentials
#   2  artifact missing or wrong file type
#   3  notarytool submission failed
#   4  stapler failed
#   5  spctl post-staple verification failed

set -euo pipefail

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

# ── Credentials ──────────────────────────────────────────────────────────────
PROFILE="${NOTARY_PROFILE:-${ASC_KEYCHAIN_PROFILE:-}}"
APPLE_SET=0
[[ -n "${APPLE_ID:-}" ]] && APPLE_SET=$((APPLE_SET + 1))
[[ -n "${APPLE_PASSWORD:-}" ]] && APPLE_SET=$((APPLE_SET + 1))
[[ -n "${APPLE_TEAM_ID:-}" ]] && APPLE_SET=$((APPLE_SET + 1))

if [[ -n "$PROFILE" ]]; then
  AUTH_ARGS=(--keychain-profile "$PROFILE")
  AUTH_DESC="keychain profile '$PROFILE'"
elif [[ "$APPLE_SET" == "3" ]]; then
  # The password goes on notarytool's argv; on an ephemeral CI runner that
  # matches what tauri-action already does for the .app.
  AUTH_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
  AUTH_DESC="Apple ID (APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID)"
elif [[ "$APPLE_SET" != "0" ]]; then
  echo "ERROR: APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID must all be set (only ${APPLE_SET} of 3 are)" >&2
  exit 1
else
  PROFILE="vskill"
  AUTH_ARGS=(--keychain-profile "$PROFILE")
  AUTH_DESC="keychain profile '$PROFILE' (default)"
fi

WAIT_ARGS=(--wait)
if [[ -n "${NOTARY_WAIT_TIMEOUT:-}" ]]; then
  WAIT_ARGS+=(--timeout "$NOTARY_WAIT_TIMEOUT")
fi

echo "==> Notarizing: $ARTIFACT"
echo "    Credentials: $AUTH_DESC"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> [dry-run] Skipping xcrun notarytool submit + stapler + spctl"
  echo "==> [dry-run] Would invoke:"
  echo "      xcrun notarytool submit \"$ARTIFACT\" <$AUTH_DESC> ${WAIT_ARGS[*]} --output-format json"
  echo "      xcrun stapler staple \"$ARTIFACT\""
  echo "      spctl -a -t open|exec -vv \"$ARTIFACT\" (open + primary-signature for .dmg)"
  exit 0
fi

# notarytool submit returns JSON we can parse for the submission ID + status.
SUBMIT_OUTPUT="$(xcrun notarytool submit "$ARTIFACT" \
  "${AUTH_ARGS[@]}" \
  "${WAIT_ARGS[@]}" \
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
    # Diagnostics only: the script exits 3 below whatever this prints.
    xcrun notarytool log "$SUBMISSION_ID" "${AUTH_ARGS[@]}" || echo "(could not fetch the notarization log)"
  fi
  exit 3
fi

echo "==> Notarization Accepted (submission $SUBMISSION_ID). Stapling…"
if ! xcrun stapler staple "$ARTIFACT"; then
  echo "ERROR: stapler failed" >&2
  exit 4
fi

echo "==> Verifying with spctl…"
# A .dmg is not executable code: spctl's default exec assessment rejects it
# ("the code is valid but does not seem to be an app"). Assess disk images
# as "open" against their own signature, and .app bundles as "exec".
case "$ARTIFACT" in
  *.dmg) SPCTL_ARGS=(-a -t open --context context:primary-signature -vv) ;;
  *)     SPCTL_ARGS=(-a -t exec -vv) ;;
esac
if ! SPCTL_OUT="$(spctl "${SPCTL_ARGS[@]}" "$ARTIFACT" 2>&1)"; then
  echo "$SPCTL_OUT" >&2
  echo "ERROR: spctl rejected the stapled artifact" >&2
  exit 5
fi
echo "$SPCTL_OUT"
case "$SPCTL_OUT" in
  *"source=Notarized Developer ID"*) ;;
  *) echo "ERROR: spctl accepted the artifact but not as 'Notarized Developer ID'" >&2; exit 5 ;;
esac

echo "==> Notarized + stapled + spctl-accepted: $ARTIFACT"
