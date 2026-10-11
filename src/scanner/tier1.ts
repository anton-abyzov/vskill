// ---------------------------------------------------------------------------
// Tier 1 Scanner -- Static pattern-based security analysis
// ---------------------------------------------------------------------------

import {
  scanContent,
  SCAN_PATTERNS,
  type ScanFinding,
  type ScanVerdict,
  type PatternSeverity,
} from "./patterns.js";

// ---- Types ----------------------------------------------------------------

export interface Tier1Result {
  verdict: ScanVerdict;
  findings: ScanFinding[];
  score: number;
  patternsChecked: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  durationMs: number;
}

// ---- Severity scoring weights ---------------------------------------------

const SEVERITY_DEDUCTIONS: Record<PatternSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

/** Score ceiling when hidden Unicode tag text is present (always FAIL). */
const HC001_SCORE_CAP = 39;

// ---- Scanner --------------------------------------------------------------

/**
 * Run the Tier 1 static scan against the provided skill content.
 *
 * Scoring starts at 100 and deducts points per finding based on severity.
 * Verdict thresholds:
 *   >= 80  PASS
 *   50-79  CONCERNS
 *   < 50   FAIL
 */
export function runTier1Scan(content: string): Tier1Result {
  const start = performance.now();

  const findings = scanContent(content);

  // Count findings by severity
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let infoCount = 0;

  for (const finding of findings) {
    switch (finding.severity) {
      case "critical":
        criticalCount++;
        break;
      case "high":
        highCount++;
        break;
      case "medium":
        mediumCount++;
        break;
      case "low":
        lowCount++;
        break;
      case "info":
        infoCount++;
        break;
    }
  }

  // Calculate score
  let score = 100;
  for (const finding of findings) {
    score -= SEVERITY_DEDUCTIONS[finding.severity];
  }
  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Hidden Unicode tag text (HC-001) has no legitimate use in a skill and
  // the platform judge caps it at FAIL; the CLI installs on Tier 1 alone, so
  // apply the same cap here.
  if (findings.some((f) => f.patternId === "HC-001" && f.severity !== "info")) {
    score = Math.min(score, HC001_SCORE_CAP);
  }

  // Determine verdict
  let verdict: ScanVerdict;
  if (score >= 80) {
    verdict = "PASS";
  } else if (score >= 50) {
    verdict = "CONCERNS";
  } else {
    verdict = "FAIL";
  }

  const durationMs = Math.round(performance.now() - start);

  return {
    verdict,
    findings,
    score,
    patternsChecked: SCAN_PATTERNS.length,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    infoCount,
    durationMs,
  };
}
