// Parse YAML frontmatter from SKILL.md content (no external YAML library)

type MetaValue = string | string[] | Record<string, string | string[]>;

export interface ParsedFrontmatter {
  metadata: Record<string, MetaValue>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const rawFm = match[1];
  const body = match[2].trim();
  const metadata: Record<string, MetaValue> = {};

  const lines = rawFm.split("\n");
  let currentKey = "";
  let inNestedBlock = false;

  for (const line of lines) {
    // Indented key-value under a parent key (one-level nesting): "  key: value"
    const nestedKv = line.match(/^[ \t]+([\w-]+):\s*(.*)$/);
    if (nestedKv && currentKey && inNestedBlock) {
      const nestedKey = nestedKv[1];
      const rawValue = nestedKv[2].trim();
      let existing = metadata[currentKey];
      if (typeof existing !== "object" || Array.isArray(existing)) {
        existing = {};
        metadata[currentKey] = existing;
      }
      if (!rawValue) {
        (existing as Record<string, MetaValue>)[nestedKey] = [];
      } else {
        const arrayMatch = rawValue.match(/^\[(.+)\]$/);
        if (arrayMatch) {
          (existing as Record<string, MetaValue>)[nestedKey] = arrayMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        } else {
          (existing as Record<string, MetaValue>)[nestedKey] = rawValue.replace(/^["']|["']$/g, "");
        }
      }
      continue;
    }

    // YAML list item: "  - value"
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      inNestedBlock = false;
      const existing = metadata[currentKey];
      if (Array.isArray(existing)) {
        existing.push(listItem[1].trim().replace(/^["']|["']$/g, ""));
      } else {
        metadata[currentKey] = [listItem[1].trim().replace(/^["']|["']$/g, "")];
      }
      continue;
    }

    // Top-level key-value: "key: value" or "key: [val1, val2]"
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const rawValue = kv[2].trim();
      inNestedBlock = false;

      if (!rawValue) {
        // Value on next lines (YAML list or nested block)
        metadata[currentKey] = {};
        inNestedBlock = true;
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

      // Inline comma-separated values (common for tags)
      // Plain value (strip quotes)
      metadata[currentKey] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  return { metadata, body };
}
