/**
 * Markdown report formatter — generates a structured security audit report.
 */

import type { AuditResult, AuditFinding } from "../audit-types.js";

/**
 * Format an AuditResult as a markdown report.
 */
export function formatReport(result: AuditResult): string {
  const lines: string[] = [];

  lines.push("# Security Audit Report");
  lines.push("");
  lines.push(`**Generated**: ${result.completedAt}`);
  lines.push(`**Root**: ${result.rootPath}`);
  lines.push("");

  // Executive Summary
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Score | ${result.summary.score}/100 |`);
  lines.push(`| Verdict | ${result.summary.verdict} |`);
  lines.push(`| Files Scanned | ${result.filesScanned} |`);
  lines.push(`| Files with Issues | ${result.filesWithFindings} |`);
  lines.push(`| Total Findings | ${result.summary.total} |`);
  lines.push(`| Duration | ${result.durationMs}ms |`);
  lines.push("");

  // Severity breakdown
  lines.push("### Severity Breakdown");
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Critical | ${result.summary.critical} |`);
  lines.push(`| High | ${result.summary.high} |`);
  lines.push(`| Medium | ${result.summary.medium} |`);
  lines.push(`| Low | ${result.summary.low} |`);
  lines.push(`| Info | ${result.summary.info} |`);
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No security issues found.");
    lines.push("");
    return lines.join("\n");
  }

  // Findings
  lines.push("## Findings");
  lines.push("");

  // Group by file
  const byFile = new Map<string, AuditFinding[]>();
  for (const f of result.findings) {
    const group = byFile.get(f.filePath) || [];
    group.push(f);
    byFile.set(f.filePath, group);
  }

  for (const [filePath, findings] of byFile) {
    lines.push(`### ${filePath}`);
    lines.push("");

    for (const f of findings) {
      lines.push(`**${f.severity.toUpperCase()}** — ${f.message} (${f.ruleId})`);
      lines.push(`- Line: ${f.line}`);
      lines.push(`- Confidence: ${f.confidence}`);
      if (f.snippet) {
        lines.push("");
        lines.push("```");
        lines.push(f.snippet);
        lines.push("```");
        lines.push("");
      }
      if (f.suggestedFix) {
        lines.push(`**Fix**: ${f.suggestedFix}`);
        lines.push("");
      }
    }
  }

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");
  if (result.summary.critical > 0) {
    lines.push("- Address all critical findings immediately before deployment");
  }
  if (result.summary.high > 0) {
    lines.push("- Review high-severity findings and apply fixes in the current sprint");
  }
  if (result.summary.medium > 0) {
    lines.push("- Plan remediation of medium-severity findings");
  }
  lines.push("- Run `vskill audit --fix` for suggested remediations");
  lines.push("- Consider enabling LLM analysis for deeper data flow tracing");
  lines.push("");

  // Scan metadata
  lines.push("## Scan Metadata");
  lines.push("");
  lines.push(`- **Tool**: vskill audit`);
  lines.push(`- **Tier 1 Only**: ${result.config.tier1Only}`);
  lines.push(`- **Max Files**: ${result.config.maxFiles}`);
  lines.push(`- **Exclude Paths**: ${result.config.excludePaths.join(", ") || "none"}`);
  lines.push("");

  return lines.join("\n");
}
