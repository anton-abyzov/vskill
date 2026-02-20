/**
 * Core audit scanner — orchestrates Tier 1 pattern scanning across files.
 *
 * Runs extended audit patterns against each discovered file and produces
 * an aggregated AuditResult with per-file findings, summary statistics,
 * score, and verdict.
 */

import { AUDIT_PATTERNS, type AuditPatternCheck } from "./audit-patterns.js";
import type {
  AuditConfig,
  AuditFile,
  AuditFinding,
  AuditResult,
  AuditSummary,
  Severity,
} from "./audit-types.js";
import type { ScanVerdict } from "../scanner/types.js";

/** Severity scoring weights (same as existing tier1.ts) */
const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

/**
 * Scan a single file against all audit patterns.
 */
function scanFile(
  file: AuditFile,
  patterns: AuditPatternCheck[],
  findingCounter: { count: number },
): AuditFinding[] {
  const lines = file.content.split("\n");
  const findings: AuditFinding[] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        // Check safe contexts
        if (pattern.safeContexts?.some((sc) => sc.test(line))) {
          break;
        }

        // Build code snippet with 2 lines context
        const snippetLines: string[] = [];
        const startLine = Math.max(0, lineIdx - 2);
        const endLine = Math.min(lines.length - 1, lineIdx + 2);
        for (let i = startLine; i <= endLine; i++) {
          const prefix = i === lineIdx ? ">" : " ";
          snippetLines.push(`${prefix} ${i + 1} | ${lines[i]}`);
        }

        findingCounter.count++;
        findings.push({
          id: `AF-${String(findingCounter.count).padStart(3, "0")}`,
          ruleId: pattern.id,
          severity: pattern.severity as Severity,
          confidence: pattern.confidence,
          category: pattern.category,
          message: pattern.message,
          filePath: file.path,
          line: lineIdx + 1,
          column: match.index + 1,
          snippet: snippetLines.join("\n"),
          source: "tier1",
        });

        // Prevent infinite loop on zero-length matches
        if (match[0].length === 0) break;
      }
    }
  }

  return findings;
}

/**
 * Run the audit scan across all provided files.
 *
 * @param files - Discovered files to scan
 * @param config - Audit configuration
 * @returns Complete AuditResult with findings, summary, and metadata
 */
export function runAuditScan(
  files: AuditFile[],
  config: AuditConfig,
): AuditResult {
  const startedAt = new Date().toISOString();
  const start = performance.now();

  const allFindings: AuditFinding[] = [];
  const filesWithFindingsSet = new Set<string>();
  const findingCounter = { count: 0 };

  for (const file of files) {
    const fileFindings = scanFile(file, AUDIT_PATTERNS, findingCounter);
    if (fileFindings.length > 0) {
      filesWithFindingsSet.add(file.path);
      allFindings.push(...fileFindings);
    }
  }

  // Sort: severity (critical first), then file path
  allFindings.sort((a, b) => {
    const sevA = SEVERITY_ORDER.indexOf(a.severity as Severity);
    const sevB = SEVERITY_ORDER.indexOf(b.severity as Severity);
    if (sevA !== sevB) return sevA - sevB;
    return a.filePath.localeCompare(b.filePath);
  });

  // Compute summary
  const summary = computeSummary(allFindings);

  const durationMs = Math.round(performance.now() - start);

  return {
    rootPath: "",
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    filesScanned: files.length,
    filesWithFindings: filesWithFindingsSet.size,
    findings: allFindings,
    summary,
    config,
  };
}

function computeSummary(findings: AuditFinding[]): AuditSummary {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let info = 0;

  for (const f of findings) {
    switch (f.severity) {
      case "critical": critical++; break;
      case "high": high++; break;
      case "medium": medium++; break;
      case "low": low++; break;
      case "info": info++; break;
    }
  }

  let score = 100;
  for (const f of findings) {
    score -= SEVERITY_DEDUCTIONS[f.severity];
  }
  score = Math.max(0, Math.min(100, score));

  let verdict: ScanVerdict;
  if (score >= 80) verdict = "PASS";
  else if (score >= 50) verdict = "CONCERNS";
  else verdict = "FAIL";

  return {
    critical, high, medium, low, info,
    total: findings.length,
    score,
    verdict,
  };
}
