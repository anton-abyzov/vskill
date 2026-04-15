#!/bin/sh
# detect-changes.sh — Report inbox file count and recently modified files
# Usage: detect-changes.sh <vault_path> <inbox_dir>
# Output: file count on first line, then list of recently modified files (last 24h)

set -e

VAULT_PATH="${1:?Usage: detect-changes.sh <vault_path> <inbox_dir>}"
INBOX_DIR="${2:?Usage: detect-changes.sh <vault_path> <inbox_dir>}"

INBOX_PATH="${VAULT_PATH}/${INBOX_DIR}"

if [ ! -d "$INBOX_PATH" ]; then
    echo "ERROR: Inbox directory not found: ${INBOX_PATH}"
    exit 1
fi

# Count files (non-recursive, files only, exclude hidden)
FILE_COUNT=0
for f in "$INBOX_PATH"/*; do
    if [ -f "$f" ]; then
        FILE_COUNT=$((FILE_COUNT + 1))
    fi
done

echo "inbox_count: ${FILE_COUNT}"

# List recently modified files (last 24 hours / 1 day)
echo "recent_modifications:"
find "$INBOX_PATH" -maxdepth 1 -type f -mtime -1 -print 2>/dev/null | while read -r filepath; do
    basename "$filepath"
done

exit 0
