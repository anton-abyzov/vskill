// Line-by-line diff using LCS (no external dependencies)

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

export function computeDiff(original: string, improved: string): DiffLine[] {
  const origLines = original.split("\n");
  const impLines = improved.split("\n");

  // Guard: fallback for very large files
  if (origLines.length > 1000 || impLines.length > 1000) {
    return [
      ...origLines.map((content) => ({ type: "unchanged" as const, content })),
    ];
  }

  const n = origLines.length;
  const m = impLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === impLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === impLines[j - 1]) {
      result.push({ type: "unchanged", content: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", content: impLines[j - 1] });
      j--;
    } else {
      result.push({ type: "removed", content: origLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}
