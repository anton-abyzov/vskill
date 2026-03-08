// ---------------------------------------------------------------------------
// verdict.ts -- four-tier eval verdict computation
// ---------------------------------------------------------------------------

export type EvalVerdict = "EFFECTIVE" | "MARGINAL" | "INEFFECTIVE" | "DEGRADING";

export function computeVerdict(
  assertionPassRate: number,
  skillRubricAvg: number,
  baselineRubricAvg: number,
): EvalVerdict {
  if (assertionPassRate >= 0.8 && skillRubricAvg > baselineRubricAvg + 1) {
    return "EFFECTIVE";
  }
  if (assertionPassRate >= 0.6 && skillRubricAvg > baselineRubricAvg) {
    return "MARGINAL";
  }
  if (assertionPassRate >= 0.4) {
    return "INEFFECTIVE";
  }
  return "DEGRADING";
}

export function verdictColor(verdict: EvalVerdict): string {
  switch (verdict) {
    case "EFFECTIVE":
      return "green";
    case "MARGINAL":
      return "yellow";
    case "INEFFECTIVE":
      return "orange";
    case "DEGRADING":
      return "red";
  }
}
