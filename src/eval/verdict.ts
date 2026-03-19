// ---------------------------------------------------------------------------
// verdict.ts -- five-tier eval verdict computation
// ---------------------------------------------------------------------------

export type EvalVerdict = "EFFECTIVE" | "MARGINAL" | "INEFFECTIVE" | "EMERGING" | "DEGRADING";

export function computeVerdict(
  assertionPassRate: number,
  skillRubricAvg: number,
  baselineRubricAvg: number,
  baselinePassRate: number = 0,
): EvalVerdict {
  const passRateDelta = assertionPassRate - baselinePassRate;

  // High pass rate zone (>= 0.8)
  if (assertionPassRate >= 0.8) {
    if (passRateDelta > 0.15 && skillRubricAvg > baselineRubricAvg + 1) {
      return "EFFECTIVE";
    }
    return "MARGINAL";
  }

  // Medium pass rate zone (>= 0.5)
  if (assertionPassRate >= 0.5) {
    if (passRateDelta > 0) {
      return "MARGINAL";
    }
    return "INEFFECTIVE";
  }

  // Low pass rate zone (< 0.5)
  if (skillRubricAvg > baselineRubricAvg) {
    return "EMERGING";
  }
  return "DEGRADING";
}

export interface RubricCriterion {
  criterion: string;
  score: number;
}

export interface VerdictExplanationResult {
  explanation: string;
  recommendations?: string[];
}

export function verdictExplanation(
  verdict: string,
  score: number,
  rubric?: RubricCriterion[],
): VerdictExplanationResult {
  const passed = rubric?.filter((r) => r.score >= 0.7) ?? [];
  const failed = rubric?.filter((r) => r.score < 0.4) ?? [];
  const weak = rubric?.filter((r) => r.score >= 0.4 && r.score < 0.7) ?? [];

  if ((verdict === "PASS" || verdict === "EFFECTIVE") && score >= 0.7) {
    const metList = passed.length > 0
      ? ` Met criteria: ${passed.map((r) => r.criterion).join(", ")}.`
      : "";
    return {
      explanation: `${verdict} (score ${score.toFixed(2)}): evaluation met expectations.${metList}`,
    };
  }

  if ((verdict === "FAIL" || verdict === "DEGRADING") && score < 0.4) {
    const failedList = failed.length > 0
      ? ` Failed criteria: ${failed.map((r) => r.criterion).join(", ")}.`
      : "";
    const recommendations = [
      ...failed.map((r) => `Improve "${r.criterion}" (score: ${r.score.toFixed(2)})`),
      ...weak.map((r) => `Strengthen "${r.criterion}" (score: ${r.score.toFixed(2)})`),
    ];
    if (recommendations.length === 0) {
      recommendations.push("Review prompt instructions and add more specific guidance");
    }
    return {
      explanation: `${verdict} (score ${score.toFixed(2)}): evaluation did not meet expectations.${failedList}`,
      recommendations,
    };
  }

  if (verdict === "INEFFECTIVE" && score < 0.2) {
    const suggestions = [
      ...failed.map((r) => `Rework "${r.criterion}" — currently at ${r.score.toFixed(2)}`),
      "Consider adding examples to your system prompt",
      "Review the rubric criteria for achievability",
    ];
    return {
      explanation: `${verdict} (score ${score.toFixed(2)}): evaluation is significantly below expectations.`,
      recommendations: suggestions,
    };
  }

  // Default/boundary case (e.g., score 0.4-0.7 or unmatched verdict)
  const metNote = passed.length > 0
    ? ` Passing: ${passed.map((r) => r.criterion).join(", ")}.`
    : "";
  const weakNote = weak.length > 0
    ? ` Needs improvement: ${weak.map((r) => r.criterion).join(", ")}.`
    : "";
  return {
    explanation: `${verdict} (score ${score.toFixed(2)}): mixed results.${metNote}${weakNote}`,
  };
}

const VERDICT_LABELS: Record<string, string> = {
  EFFECTIVE: "Strong Improvement",
  MARGINAL: "Moderate Improvement",
  EMERGING: "Early Promise",
  INEFFECTIVE: "Needs Work",
  DEGRADING: "Regression",
};

export function verdictLabel(verdict: string): string {
  return VERDICT_LABELS[verdict] ?? verdict;
}

export function verdictColor(verdict: EvalVerdict): string {
  switch (verdict) {
    case "EFFECTIVE":
      return "green";
    case "MARGINAL":
      return "yellow";
    case "INEFFECTIVE":
      return "orange";
    case "EMERGING":
      return "cyan";
    case "DEGRADING":
      return "red";
  }
}
