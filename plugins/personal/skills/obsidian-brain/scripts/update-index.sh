#!/bin/sh
# update-index.sh — Regenerate wiki/index.md from wiki page frontmatter
# Usage: update-index.sh <vault_path> <wiki_dir> <index_file>
# Reads all .md files in wiki_dir, extracts title from frontmatter, writes index

set -e

VAULT_PATH="${1:?Usage: update-index.sh <vault_path> <wiki_dir> <index_file>}"
WIKI_DIR="${2:?Usage: update-index.sh <vault_path> <wiki_dir> <index_file>}"
INDEX_FILE="${3:?Usage: update-index.sh <vault_path> <wiki_dir> <index_file>}"

WIKI_PATH="${VAULT_PATH}/${WIKI_DIR}"
INDEX_PATH="${VAULT_PATH}/${INDEX_FILE}"

if [ ! -d "$WIKI_PATH" ]; then
    echo "ERROR: Wiki directory not found: ${WIKI_PATH}"
    exit 1
fi

# Build new index content
TEMP_INDEX="${INDEX_PATH}.tmp"

echo "# Wiki Index" > "$TEMP_INDEX"
echo "" >> "$TEMP_INDEX"
echo "Auto-generated catalog of all wiki pages." >> "$TEMP_INDEX"
echo "" >> "$TEMP_INDEX"

# Process each markdown file in wiki dir (exclude index.md, log.md, overview.md)
find "$WIKI_PATH" -maxdepth 2 -name '*.md' -type f -print | sort | while read -r filepath; do
    filename=$(basename "$filepath" .md)

    # Skip system files
    case "$filename" in
        index|log|overview) continue ;;
    esac

    # Extract title from frontmatter (line matching "title: ")
    title=""
    in_frontmatter=0
    while IFS= read -r line; do
        case "$line" in
            "---")
                if [ "$in_frontmatter" -eq 0 ]; then
                    in_frontmatter=1
                else
                    break
                fi
                ;;
            title:*)
                if [ "$in_frontmatter" -eq 1 ]; then
                    # Strip "title: " prefix and surrounding quotes
                    title=$(echo "$line" | sed 's/^title:[[:space:]]*//' | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')
                fi
                ;;
        esac
    done < "$filepath"

    # Fall back to filename if no title found
    if [ -z "$title" ]; then
        title="$filename"
    fi

    echo "- [[${filename}]] -- ${title}" >> "$TEMP_INDEX"
done

# Atomic replace
mv "$TEMP_INDEX" "$INDEX_PATH"

echo "Index rebuilt: ${INDEX_PATH}"
exit 0
