#!/usr/bin/env bash
# T-014 (0682): Coverage threshold gate for new modules.
#
# Reads coverage/coverage-summary.json (Vitest v8 provider output) and asserts
# linesPct >= 90 for every new module shipped by 0682 — the AC-US7-* / AC-US4-*
# / AC-US2-* surfaces gain ≥90% coverage as part of closure.
#
# Usage:
#   npm test -- --coverage
#   bash scripts/check-coverage-thresholds.sh
#
# Exits non-zero if any listed module's lines coverage is below 90%.
# Requires `@vitest/coverage-v8` (not bundled — install with
# `npm install --save-dev @vitest/coverage-v8` before running coverage).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMMARY="${REPO_ROOT}/coverage/coverage-summary.json"

if [ ! -f "${SUMMARY}" ]; then
  echo "FAIL: coverage summary missing at ${SUMMARY}" >&2
  echo "      Run: npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=json-summary" >&2
  exit 1
fi

# Modules introduced by 0682 — each MUST hit ≥90% line coverage to close.
MODULES=(
  "src/eval-ui/src/hooks/useAgentCatalog.ts"
  "src/eval-ui/src/components/AgentModelPicker.tsx"
  "src/eval-ui/src/components/AgentList.tsx"
  "src/eval-ui/src/components/ModelList.tsx"
  "src/eval-ui/src/components/LockedProviderRow.tsx"
  "src/eval-ui/src/components/SettingsModal.tsx"
  "src/eval-ui/src/components/ProvidersSegment.tsx"
  "src/eval-ui/src/hooks/useVirtualList.ts"
  "src/eval-ui/src/settings/keyStore.ts"
  "src/eval-server/settings-store.ts"
  "src/eval-server/studio-json.ts"
  "src/eval/env.ts"
)

THRESHOLD=90
FAILED=0
for mod in "${MODULES[@]}"; do
  pct=$(node -e "const j=require('${SUMMARY}'); const k=Object.keys(j).find(k=>k.endsWith('${mod}')); console.log(k?(j[k].lines?.pct ?? 'n/a'):'missing');" 2>/dev/null || echo "missing")
  if [ "${pct}" = "missing" ]; then
    echo "WARN: ${mod} not in coverage summary (no test exercises it?)"
    FAILED=$((FAILED+1))
  elif [ "${pct}" = "n/a" ]; then
    echo "WARN: ${mod} has no lines metric"
    FAILED=$((FAILED+1))
  else
    awkout=$(awk -v p="${pct}" -v t="${THRESHOLD}" 'BEGIN{ if (p+0 >= t) print "PASS"; else print "FAIL"; }')
    if [ "${awkout}" = "FAIL" ]; then
      echo "FAIL: ${mod} lines=${pct}% (< ${THRESHOLD}%)"
      FAILED=$((FAILED+1))
    else
      echo "OK:   ${mod} lines=${pct}%"
    fi
  fi
done

if [ ${FAILED} -gt 0 ]; then
  echo ""
  echo "Coverage gate failed — ${FAILED} module(s) below ${THRESHOLD}%."
  exit 1
fi

echo ""
echo "All ${#MODULES[@]} modules at or above ${THRESHOLD}% line coverage."
