/**
 * Types and interfaces for the vskill audit module.
 */

import type { PatternCheck, Severity, ScanVerdict } from "../scanner/types.js";

// Re-export for convenience
export type { Severity, ScanVerdict };

/** Confidence level for a finding */
export type Confidence = "high" | "medium" | "low";

/** Source of a finding */
export type FindingSource = "tier1" | "llm";

/** A file discovered for auditing */
export interface AuditFile {
  /** Relative path within the audited directory */
  path: string;
  /** File content as a string */
  content: string;
  /** File size in bytes */
  sizeBytes: number;
}

/** A single step in a data flow trace */
export interface DataFlowStep {
  file: string;
  line: number;
  description: string;
  code: string;
}

/** Data flow trace from LLM analysis */
export interface DataFlowTrace {
  steps: DataFlowStep[];
}

/** A single audit finding */
export interface AuditFinding {
  /** Unique finding ID (e.g., "AF-001") */
  id: string;
  /** Pattern/rule ID that triggered this finding */
  ruleId: string;
  /** Severity level */
  severity: Severity;
  /** Confidence level */
  confidence: Confidence;
  /** Category of the vulnerability */
  category: string;
  /** Human-readable description */
  message: string;
  /** Relative file path */
  filePath: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (optional) */
  column?: number;
  /** End line number (optional, for multi-line findings) */
  endLine?: number;
  /** Code snippet with context */
  snippet: string;
  /** Source of the finding */
  source: FindingSource;
  /** Data flow trace (from LLM analysis) */
  dataFlow?: DataFlowTrace;
  /** Suggested remediation (when --fix is used) */
  suggestedFix?: string;
}

/** Summary statistics for an audit */
export interface AuditSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
  score: number;
  verdict: ScanVerdict;
}

/** Configuration for an audit run */
export interface AuditConfig {
  excludePaths: string[];
  severityThreshold: Severity;
  maxFiles: number;
  maxFileSize: number;
  tier1Only: boolean;
  llmProvider: string | null;
  llmTimeout: number;
  llmConcurrency: number;
  customPatterns: PatternCheck[];
  fix: boolean;
}

/** Complete audit result */
export interface AuditResult {
  rootPath: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  filesScanned: number;
  filesWithFindings: number;
  findings: AuditFinding[];
  summary: AuditSummary;
  config: AuditConfig;
}

/** Create a default AuditConfig with sensible defaults */
export function createDefaultAuditConfig(): AuditConfig {
  return {
    excludePaths: [],
    severityThreshold: "low",
    maxFiles: 500,
    maxFileSize: 100 * 1024,
    tier1Only: false,
    llmProvider: null,
    llmTimeout: 30_000,
    llmConcurrency: 5,
    customPatterns: [],
    fix: false,
  };
}
