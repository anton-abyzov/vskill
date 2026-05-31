#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Record the Skill Studio anton-grid submission → update lifecycle VIDEO-DEMO
# and lift the produced .webm to the stable deliverable path.
#
#   Usage:  bash e2e/scripts/record-lifecycle-demo.sh
#
# Runs the dedicated `demo` Playwright project (lifecycle-demo-video.spec.ts),
# then copies Playwright's per-run video.webm to
# e2e/demo-output/lifecycle-demo.webm.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="$REPO_ROOT/e2e/demo-output"
OUT_FILE="$OUT_DIR/lifecycle-demo.webm"

# Isolate the workspace registry (mirrors playwright.config webServer env).
rm -rf /tmp/vskill-e2e-workspace

echo "[demo] running Playwright demo project…"
npx playwright test --project=demo

# Locate the freshest recorded video for this spec.
SRC="$(find "$REPO_ROOT/test-results" -path '*lifecycle-demo-video*' -name 'video.webm' -print0 \
  | xargs -0 ls -t 2>/dev/null | head -1)"

if [[ -z "${SRC:-}" || ! -f "$SRC" ]]; then
  echo "[demo] ERROR: no video.webm produced under test-results/" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$SRC" "$OUT_FILE"
echo "[demo] video → $OUT_FILE"
ls -la "$OUT_FILE"
