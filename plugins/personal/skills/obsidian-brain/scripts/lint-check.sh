#!/bin/sh
# lint-check.sh — Deterministic vault health checks
# Usage: lint-check.sh <vault_path> <wiki_dir> <index_file> <inbox_dir> [backlog_threshold]
# Output: orphan pages, missing cross-refs, inbox backlog count
# Exit code: 0 = clean, 1 = findings exist, 2 = error

set -e

VAULT_PATH="${1:?Usage: lint-check.sh <vault_path> <wiki_dir> <index_file> <inbox_dir> [backlog_threshold]}"
WIKI_DIR="${2:?Usage: lint-check.sh <vault_path> <wiki_dir> <index_file> <inbox_dir> [backlog_threshold]}"
INDEX_FILE="${3:?Usage: lint-check.sh <vault_path> <wiki_dir> <index_file> <inbox_dir> [backlog_threshold]}"
INBOX_DIR="${4:?Usage: lint-check.sh <vault_path> <wiki_dir> <index_file> <inbox_dir> [backlog_threshold]}"
BACKLOG_THRESHOLD="${5:-10}"

WIKI_PATH="${VAULT_PATH}/${WIKI_DIR}"
INDEX_PATH="${VAULT_PATH}/${INDEX_FILE}"
INBOX_PATH="${VAULT_PATH}/${INBOX_DIR}"

FINDINGS=0

if [ ! -d "$WIKI_PATH" ]; then
    echo "ERROR: Wiki directory not found: ${WIKI_PATH}"
    exit 2
fi

if [ ! -f "$INDEX_PATH" ]; then
    echo "ERROR: Index file not found: ${INDEX_PATH}"
    exit 2
fi

# --- Check 1: Orphan pages (in wiki/ but not in index) ---
echo "=== Orphan Pages ==="
TEMP_ORPHANS=$(mktemp)
find "$WIKI_PATH" -maxdepth 2 -name '*.md' -type f -print | while read -r filepath; do
    filename=$(basename "$filepath" .md)
    # Skip system files
    if [ "$filename" = "index" ] || [ "$filename" = "log" ] || [ "$filename" = "overview" ]; then
        continue
    fi
    if ! grep -q "\[\[${filename}\]\]" "$INDEX_PATH" 2>/dev/null; then
        echo "  [error] orphan: ${filename}.md (not in index)"
        echo "x" >> "$TEMP_ORPHANS"
    fi
done
ORPHAN_COUNT=$(wc -l < "$TEMP_ORPHANS" | tr -d ' ')
rm -f "$TEMP_ORPHANS"

if [ "$ORPHAN_COUNT" -gt 0 ]; then
    FINDINGS=1
fi
echo "  total: ${ORPHAN_COUNT} orphan(s)"
echo ""

# --- Check 2: Missing wikilink targets ---
echo "=== Missing Wikilink Targets ==="
MISSING_COUNT=0
# Extract all wikilinks from wiki pages
TEMP_LINKS=$(mktemp)
grep -roh '\[\[[^]]*\]\]' "$WIKI_PATH" 2>/dev/null | sed 's/\[\[//g; s/\]\]//g' | sort -u > "$TEMP_LINKS"

while IFS= read -r link; do
    # Skip empty lines
    [ -z "$link" ] && continue
    # Check if the target file exists anywhere in the vault
    target_found=0
    if [ -f "${WIKI_PATH}/${link}.md" ]; then
        target_found=1
    elif find "$VAULT_PATH" -name "${link}.md" -type f -print -quit 2>/dev/null | grep -q .; then
        target_found=1
    fi
    if [ "$target_found" -eq 0 ]; then
        echo "  [warning] missing target: [[${link}]]"
        MISSING_COUNT=$((MISSING_COUNT + 1))
    fi
done < "$TEMP_LINKS"
rm -f "$TEMP_LINKS"

if [ "$MISSING_COUNT" -gt 0 ]; then
    FINDINGS=1
fi
echo "  total: ${MISSING_COUNT} missing target(s)"
echo ""

# --- Check 3: Inbox backlog ---
echo "=== Inbox Backlog ==="
INBOX_COUNT=0
if [ -d "$INBOX_PATH" ]; then
    for f in "$INBOX_PATH"/*; do
        if [ -f "$f" ]; then
            INBOX_COUNT=$((INBOX_COUNT + 1))
        fi
    done
fi

echo "  count: ${INBOX_COUNT} file(s)"
echo "  threshold: ${BACKLOG_THRESHOLD}"
if [ "$INBOX_COUNT" -gt "$BACKLOG_THRESHOLD" ]; then
    echo "  [warning] inbox backlog exceeds threshold (${INBOX_COUNT} > ${BACKLOG_THRESHOLD})"
    FINDINGS=1
else
    echo "  [ok] within threshold"
fi
echo ""

# --- Summary ---
echo "=== Summary ==="
echo "  orphans: ${ORPHAN_COUNT}"
echo "  missing_targets: ${MISSING_COUNT}"
echo "  inbox_backlog: ${INBOX_COUNT}/${BACKLOG_THRESHOLD}"

if [ "$FINDINGS" -gt 0 ]; then
    echo "  status: FINDINGS_EXIST"
    exit 1
else
    echo "  status: CLEAN"
    exit 0
fi
