export { scanContent, SCAN_PATTERNS } from "./patterns.js";
export type {
  ScanPattern,
  ScanFinding,
  ScanVerdict,
  PatternSeverity,
  PatternCategory,
} from "./patterns.js";

export { runTier1Scan } from "./tier1.js";
export type { Tier1Result } from "./tier1.js";

// Tier 2 LLM-based scanning
export { runTier2Scan } from "./tier2-llm.js";
export type { AIBinding } from "./tier2-llm.js";

// Full-repository scanning
export { shallowClone, discoverFiles, scanRepository } from "./repo-scanner.js";

// Shared types (Tier 2 + repo scanner)
export type {
  Severity,
  SecurityFinding,
  ScanResult,
  PatternCheck,
  RepoFile,
  Tier2Result,
} from "./types.js";
