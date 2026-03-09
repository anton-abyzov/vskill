// Parse YAML frontmatter from SKILL.md content (no external YAML library)

export interface ParsedFrontmatter {
  metadata: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const rawFm = match[1];
  const body = match[2].trim();
  const metadata: Record<string, string | string[]> = {};

  const lines = rawFm.split("\n");
  let currentKey = "";

  for (const line of lines) {
    // YAML list item: "  - value"
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      const existing = metadata[currentKey];
      if (Array.isArray(existing)) {
        existing.push(listItem[1].trim().replace(/^["']|["']$/g, ""));
      } else {
        metadata[currentKey] = [listItem[1].trim().replace(/^["']|["']$/g, "")];
      }
      continue;
    }

    // Key-value: "key: value" or "key: [val1, val2]"
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const rawValue = kv[2].trim();

      if (!rawValue) {
        // Value on next lines (YAML list)
        metadata[currentKey] = [];
        continue;
      }

      // Inline array: [val1, val2, val3]
      const arrayMatch = rawValue.match(/^\[(.+)\]$/);
      if (arrayMatch) {
        metadata[currentKey] = arrayMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
        continue;
      }

      // Plain value (strip quotes)
      metadata[currentKey] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  return { metadata, body };
}
