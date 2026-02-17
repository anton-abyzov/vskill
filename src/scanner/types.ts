/**
 * Shared types for the @vskill/scanner package.
 */

/** Severity levels for security findings */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** A single security finding from scanning */
export interface SecurityFinding {
  /** Severity level */
  severity: Severity;
  /** Finding category (e.g., 'destructive-command', 'remote-code-execution') */
  category: string;
  /** Human-readable description of the finding */
  message: string;
  /** Line number in the file where the finding was detected */
  line?: number;
}

/** Result from a security scan */
export interface ScanResult {
  /** Whether the scan passed (no critical or high findings) */
  passed: boolean;
  /** All individual findings */
  findings: SecurityFinding[];
}

/** A pattern check definition used by the Tier 1 scanner */
export interface PatternCheck {
  /** Regular expression pattern to match */
  pattern: RegExp;
  /** Severity level if matched */
  severity: Severity;
  /** Category of the finding */
  category: string;
  /** Human-readable message describing the finding */
  message: string;
  /** If provided, the finding is suppressed when a safe-context regex matches the line */
  safeContexts?: RegExp[];
}

/** Represents a file discovered in a repository for scanning */
export interface RepoFile {
  /** Relative path within the repository */
  path: string;
  /** File content as a string */
  content: string;
  /** File size in bytes */
  sizeBytes: number;
}

/** Result from the Tier 2 LLM-based scan */
export interface Tier2Result {
  /** Score from 0 (most dangerous) to 100 (safest) */
  score: number;
  /** Overall verdict */
  verdict: ScanVerdict;
  /** LLM's rationale for the verdict */
  rationale: string;
  /** Model identifier used for the scan */
  model: string;
}

/** Overall verdict for a scan */
export type ScanVerdict = 'PASS' | 'CONCERNS' | 'FAIL';
