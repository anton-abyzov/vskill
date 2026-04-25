#!/usr/bin/env bash
# check-bundle-compliance.sh — NFR-006 dist bundle grep gate.
#
# After `npm run build`, assert that no compiled .js file contains any
# literal credential-file path associated with ~/.claude/ in *executable*
# code paths. Doc-block comments mandated by AC-US5-02 are explicitly
# allowed — those lines describe the compliance contract and cannot
# trigger any fs read at runtime. The gate skips:
#   - lines starting with `//` (line comments)
#   - lines that are inside ` * ... ` block-comment continuations
#   - lines that are inside ` /* ... */ ` block-comment one-liners
# and inspects only the residual code lines.
#
# If this script exits non-zero, the CI job fails and the increment
# cannot close.
set -euo pipefail

DIST_DIR="${1:-dist}"

if [ ! -d "$DIST_DIR" ]; then
  echo "check-bundle-compliance: dist dir '$DIST_DIR' not found. Run npm run build first." >&2
  exit 2
fi

# Strip JS comments line-wise. Conservative regex:
#   - Drop lines whose first non-whitespace chars are `//` or `*` or `/*`.
#   - Lines mixing code + trailing `// comment` keep the code half (rare in
#     dist output from tsc/esbuild, which usually preserves comments on
#     their own lines), but still get checked — that's safe.
strip_comments() {
  # `grep -v` chained: drop pure-comment lines.
  grep -vE '^[[:space:]]*(//|\*|/\*)' "$1" 2>/dev/null || true
}

# Forbidden literal substrings — must NOT appear in residual code.
PATTERNS=(
  '"\.claude/credentials"'
  '"\.claude/auth"'
  '"\.claude/token"'
  'credentials\.json'
)

# Wider sanity regex applied to residual code only.
WIDE_PATTERN='\.claude/(credentials|auth|token)'

HITS=0

while IFS= read -r jsfile; do
  residual="$(strip_comments "$jsfile")"
  [ -z "$residual" ] && continue
  for pattern in "${PATTERNS[@]}"; do
    if printf '%s\n' "$residual" | grep -qE "$pattern"; then
      echo "VIOLATION ($jsfile): bundle literal matching '$pattern' in code"
      printf '%s\n' "$residual" | grep -nE "$pattern" || true
      HITS=$((HITS + 1))
    fi
  done
  if printf '%s\n' "$residual" | grep -qE "$WIDE_PATTERN"; then
    echo "VIOLATION ($jsfile): wider regex .claude/(credentials|auth|token) in code"
    printf '%s\n' "$residual" | grep -nE "$WIDE_PATTERN" || true
    HITS=$((HITS + 1))
  fi
done < <(find "$DIST_DIR" -type f -name '*.js')

if [ "$HITS" -gt 0 ]; then
  echo ""
  echo "check-bundle-compliance FAILED ($HITS violation group(s))." >&2
  exit 1
fi

echo "check-bundle-compliance PASSED — no credential-path literals in $DIST_DIR (excluding doc-block comments)"
