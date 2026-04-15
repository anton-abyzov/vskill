export interface UnifiedDiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
}

export function parseUnifiedDiff(diffStr: string): UnifiedDiffLine[] {
  if (!diffStr) return [];

  const lines = diffStr.split("\n");
  const result: UnifiedDiffLine[] = [];

  for (const line of lines) {
    // Skip file header lines
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;

    // Hunk header
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
      continue;
    }

    // Addition
    if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1) });
      continue;
    }

    // Deletion
    if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1) });
      continue;
    }

    // Context line (starts with space) or empty context line
    if (line.startsWith(" ") || (line === "" && result.length > 0)) {
      result.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : "" });
    }
  }

  return result;
}
