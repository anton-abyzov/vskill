#!/usr/bin/env bash
# check-bundle-compliance.sh — NFR-006 dist bundle grep gate.
#
# After `npm run build`, assert that no compiled .js file contains any
# literal credential-file path associated with ~/.claude/. If this script
# exits non-zero, the CI job fails and the increment cannot close.
set -euo pipefail

DIST_DIR="${1:-dist}"

if [ ! -d "$DIST_DIR" ]; then
  echo "check-bundle-compliance: dist dir '$DIST_DIR' not found. Run npm run build first." >&2
  exit 2
fi

PATTERNS=(
  '"\.claude/credentials"'
  '"\.claude/auth"'
  '"\.claude/token"'
  'credentials\.json'
)

HITS=0
for pattern in "${PATTERNS[@]}"; do
  # -r recursive, -n line numbers, -E extended regex; filter to .js files only.
  MATCHES=$(grep -rnE --include="*.js" "$pattern" "$DIST_DIR" || true)
  if [ -n "$MATCHES" ]; then
    # Allow matches that are clearly about `.claude/` folders unrelated to
    # credential material — but the exact forbidden literals above are
    # never legitimate in shipping code.
    echo "VIOLATION: bundle literal '$pattern' matched:"
    echo "$MATCHES"
    HITS=$((HITS + 1))
  fi
done

# Wider regex: anything matching .claude/(credentials|auth|token)
WIDE=$(grep -rnE --include="*.js" '\.claude/(credentials|auth|token)' "$DIST_DIR" || true)
if [ -n "$WIDE" ]; then
  echo "VIOLATION: wider regex .claude/(credentials|auth|token):"
  echo "$WIDE"
  HITS=$((HITS + 1))
fi

if [ "$HITS" -gt 0 ]; then
  echo ""
  echo "check-bundle-compliance FAILED ($HITS violation group(s))." >&2
  exit 1
fi

echo "check-bundle-compliance PASSED — no credential-path literals in $DIST_DIR"
