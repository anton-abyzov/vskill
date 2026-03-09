// Types mirroring backend API shapes (no backend imports to avoid tsconfig clash)

export interface Assertion {
  id: string;
  text: string;
  type: "boolean";
}

export interface EvalCase {
  id: number;
  name: string;
  prompt: string;
  expected_output: string;
  files: string[];
  assertions: Assertion[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
}

export interface SkillInfo {
  plugin: string;
  skill: string;
  dir: string;
  hasEvals: boolean;
  hasBenchmark: boolean;
  evalCount: number;
  assertionCount: number;
  benchmarkStatus: "pass" | "fail" | "pending" | "missing";
  lastBenchmark: string | null;
}

export interface BenchmarkAssertionResult {
  id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

export interface BenchmarkCase {
  eval_id: number;
  eval_name: string;
  status: "pass" | "fail" | "error";
  error_message: string | null;
  pass_rate: number;
  durationMs?: number;
  tokens?: number | null;
  assertions: BenchmarkAssertionResult[];
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  skill_name: string;
  cases: BenchmarkCase[];
  overall_pass_rate?: number;
  type?: "benchmark" | "comparison";
  verdict?: string;
  comparison?: {
    skillPassRate: number;
    baselinePassRate: number;
    skillRubricAvg: number;
    baselineRubricAvg: number;
    delta: number;
  };
}

export interface HistorySummary {
  timestamp: string;
  filename: string;
  model: string;
  skillName: string;
  passRate: number;
  type: "benchmark" | "comparison";
}

export interface ActivationResult {
  prompt: string;
  expected: "should_activate" | "should_not_activate";
  activate: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  classification: "TP" | "TN" | "FP" | "FN";
}

export interface ActivationSummary {
  results: ActivationResult[];
  precision: number;
  recall: number;
  reliability: number;
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
}
