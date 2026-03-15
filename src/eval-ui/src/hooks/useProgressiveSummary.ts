import { useMemo } from "react";
import { computeVerdict } from "../../../eval/verdict.js";
import type { EvalVerdict } from "../../../eval/verdict.js";
import type { SSEEvent } from "../sse";

interface AssertionResultData {
  eval_id: number;
  assertion_id: number;
  text: string;
  pass: boolean;
  reasoning: string;
}

interface CaseCompleteData {
  eval_id: number;
  status: string;
  pass_rate: number;
}

interface ComparisonOutputsData {
  eval_id: number;
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
}

export interface ProgressiveSummary {
  completedCount: number;
  totalCount: number;
  skillAvg: number;
  baselineAvg: number;
  delta: number;
  passRate: number;
  previewVerdict: EvalVerdict | null;
}

export function useProgressiveSummary(
  events: SSEEvent[],
  totalCases: number,
): ProgressiveSummary {
  return useMemo(() => {
    const outputsByCase = new Map<number, ComparisonOutputsData>();
    const assertionsByCase = new Map<number, AssertionResultData[]>();
    const completedCases = new Map<number, CaseCompleteData>();

    for (const evt of events) {
      if (evt.event === "outputs_ready") {
        const d = evt.data as ComparisonOutputsData;
        outputsByCase.set(d.eval_id, d);
      } else if (evt.event === "assertion_result") {
        const d = evt.data as AssertionResultData;
        const arr = assertionsByCase.get(d.eval_id) ?? [];
        // Deduplicate by assertion_id
        if (!arr.some((a) => a.assertion_id === d.assertion_id)) {
          arr.push(d);
        }
        assertionsByCase.set(d.eval_id, arr);
      } else if (evt.event === "case_complete") {
        const d = evt.data as CaseCompleteData;
        completedCases.set(d.eval_id, d);
      }
    }

    const completedCount = completedCases.size;

    if (completedCount === 0) {
      return {
        completedCount: 0,
        totalCount: totalCases,
        skillAvg: 0,
        baselineAvg: 0,
        delta: 0,
        passRate: 0,
        previewVerdict: null,
      };
    }

    // Compute running averages from completed cases that have outputs
    let skillTotal = 0;
    let baselineTotal = 0;
    let scoredCount = 0;
    let totalAssertions = 0;
    let passedAssertions = 0;

    for (const [evalId] of completedCases) {
      const outputs = outputsByCase.get(evalId);
      if (outputs) {
        skillTotal += (outputs.skillContentScore + outputs.skillStructureScore) / 2;
        baselineTotal += (outputs.baselineContentScore + outputs.baselineStructureScore) / 2;
        scoredCount++;
      }
      const assertions = assertionsByCase.get(evalId) ?? [];
      totalAssertions += assertions.length;
      passedAssertions += assertions.filter((a) => a.pass).length;
    }

    const skillAvg = scoredCount > 0 ? skillTotal / scoredCount : 0;
    const baselineAvg = scoredCount > 0 ? baselineTotal / scoredCount : 0;
    const delta = skillAvg - baselineAvg;
    const passRate = totalAssertions > 0 ? passedAssertions / totalAssertions : 0;
    const previewVerdict = computeVerdict(passRate, skillAvg, baselineAvg);

    return {
      completedCount,
      totalCount: totalCases,
      skillAvg,
      baselineAvg,
      delta,
      passRate,
      previewVerdict,
    };
  }, [events.length, totalCases]);
}
