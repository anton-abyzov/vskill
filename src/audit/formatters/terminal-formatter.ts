/**
 * Terminal formatter — renders AuditResult as colored terminal output.
 */

import type { AuditResult, AuditFinding } from "../audit-types.js";

/**
 * Format an AuditResult as a human-readable terminal string.
 * Uses plain text (colors applied by the CLI command layer).
 */
export function formatTerminal(result: AuditResult): string {
  const lines: string[] = [];

  // Header
  lines.push("vskill audit");
  lines.push("");
  lines.push(
    `Score: ${result.summary.score}/100  ` +
    `Verdict: ${result.summary.verdict}  ` +
    `Files: ${result.filesScanned}  ` +
    `Time: ${result.durationMs}ms`,
  );
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No security issues found.");
    lines.push("");
    return lines.join("\n");
  }

  // Summary counts
  const parts: string[] = [];
  if (result.summary.critical > 0) parts.push(`${result.summary.critical} critical`);
  if (result.summary.high > 0) parts.push(`${result.summary.high} high`);
  if (result.summary.medium > 0) parts.push(`${result.summary.medium} medium`);
  if (result.summary.low > 0) parts.push(`${result.summary.low} low`);
  if (result.summary.info > 0) parts.push(`${result.summary.info} info`);
  lines.push(`Findings: ${parts.join("  ")}`);
  lines.push("");

  // Group findings by file
  const byFile = new Map<string, AuditFinding[]>();
  for (const f of result.findings) {
    const group = byFile.get(f.filePath) || [];
    group.push(f);
    byFile.set(f.filePath, group);
  }

  for (const [filePath, findings] of byFile) {
    lines.push(`── ${filePath} (${findings.length} finding${findings.length > 1 ? "s" : ""})`);
    lines.push("");

    for (const f of findings) {
      lines.push(`  ${f.severity.toUpperCase()} [${f.ruleId}] ${f.message}`);
      lines.push(`  Line ${f.line}`);
      if (f.snippet) {
        lines.push("");
        for (const snippetLine of f.snippet.split("\n")) {
          lines.push(`    ${snippetLine}`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
