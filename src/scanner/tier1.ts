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
import { ADVISORY_IDS } from "./judge-guard.js";

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
 * HC-014 (visible text addressed to an AI reviewer) only asks for the LLM
 * judge. The CLI installs on Tier 1 alone and has no judge to send it to, so
 * it is reported but not scored. HC-009 (hidden or forged) still scores.
 */
const CLI_UNSCORED_IDS: ReadonlySet<string> = new Set(["HC-014"]);

/**
 * Severity used for counts and the score. Advisory findings (look-alike
 * domains, mixed-script words) are common in localized docs: they are
 * reported at their own severity but score as info, so they cannot push a
 * skill below the install threshold on their own.
 */
function scoredSeverity(finding: ScanFinding): PatternSeverity {
  return ADVISORY_IDS.has(finding.patternId) || CLI_UNSCORED_IDS.has(finding.patternId) ? "info" : finding.severity;
}

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

  // Repeated matches on one line are folded into one finding (see
  // scanContent); count and score each occurrence, so folding bounds the
  // work without raising the score the CLI installs on. Findings folded in
  // past scanContent's caps (foldedFindings) add their occurrences to the
  // holder, so they are counted here too.
  for (const finding of findings) {
    const n = finding.occurrences ?? 1;
    switch (scoredSeverity(finding)) {
      case "critical":
        criticalCount += n;
        break;
      case "high":
        highCount += n;
        break;
      case "medium":
        mediumCount += n;
        break;
      case "low":
        lowCount += n;
        break;
      case "info":
        infoCount += n;
        break;
    }
  }

  // Calculate score
  let score = 100;
  for (const finding of findings) {
    score -= SEVERITY_DEDUCTIONS[scoredSeverity(finding)] * (finding.occurrences ?? 1);
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
