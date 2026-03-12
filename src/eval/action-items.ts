// ---------------------------------------------------------------------------
// action-items.ts -- generate actionable recommendations from A/B comparison
// ---------------------------------------------------------------------------

import type { LlmClient } from "./llm.js";
import type { EvalVerdict } from "./verdict.js";
import type { ActionItems, BenchmarkAssertionResult } from "./benchmark.js";

interface ComparisonStats {
  passRate: number;
  skillRubricAvg: number;
  baselineRubricAvg: number;
  delta: number;
}

interface CaseResult {
  eval_id: number;
  eval_name: string;
  winner: "skill" | "baseline" | "tie";
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
  assertionResults: BenchmarkAssertionResult[];
}

const SYSTEM_PROMPT = `You are an expert skill evaluator analyzing A/B comparison results.

A skill file (SKILL.md) guides an AI assistant's behavior. An A/B comparison runs the same prompts with and without the skill, then blind-scores both outputs on content (1-5) and structure (1-5).

Analyze the results and produce concrete, actionable recommendations.

Respond with ONLY valid JSON (no code fences, no preamble):
{
  "recommendation": "keep" | "improve" | "rewrite" | "remove",
  "summary": "<1-2 sentences: what happened and what to do>",
  "weaknesses": ["<specific weakness 1>", ...],
  "strengths": ["<specific strength 1>", ...],
  "suggestedFocus": "<the single most impactful change to make>"
}

Recommendation criteria:
- "keep": Skill clearly beats baseline — high pass rate (>=80%), consistent wins, delta > +1
- "improve": Skill shows promise but has fixable weaknesses — moderate pass rate, some wins
- "rewrite": Skill barely helps or is inconsistent — low pass rate, mixed wins/losses
- "remove": Skill actively degrades output — baseline consistently wins, negative delta

Be specific in weaknesses and strengths — reference actual eval cases and scores, not generic advice.
Keep suggestedFocus to one concrete, actionable sentence.`;

function buildUserPrompt(
  verdict: EvalVerdict,
  stats: ComparisonStats,
  cases: CaseResult[],
  skillContent: string,
): string {
  const caseBreakdown = cases.map((c) => {
    const failed = c.assertionResults.filter((a) => !a.pass);
    const failedSection = failed.length > 0
      ? failed.map((a) => `  - FAIL: ${a.text} — ${a.reasoning}`).join("\n")
      : "  (all passed)";
    return `### Case: "${c.eval_name}" (eval #${c.eval_id})
- Winner: ${c.winner}
- Skill scores: content=${c.skillContentScore}/5, structure=${c.skillStructureScore}/5
- Baseline scores: content=${c.baselineContentScore}/5, structure=${c.baselineStructureScore}/5
- Assertions: ${c.assertionResults.filter((a) => a.pass).length}/${c.assertionResults.length} passed
${failedSection}`;
  }).join("\n\n");

  // Truncate skill content to avoid token bloat (keep first 2000 chars)
  const truncatedSkill = skillContent.length > 2000
    ? skillContent.slice(0, 2000) + "\n\n[... truncated ...]"
    : skillContent;

  return `## Verdict: ${verdict}

## Comparison Statistics
- Assertion pass rate: ${Math.round(stats.passRate * 100)}%
- Skill rubric average: ${stats.skillRubricAvg.toFixed(1)}/5
- Baseline rubric average: ${stats.baselineRubricAvg.toFixed(1)}/5
- Delta: ${stats.delta > 0 ? "+" : ""}${stats.delta.toFixed(1)}

## Per-Case Breakdown
${caseBreakdown}

## SKILL.md Content
${truncatedSkill}

Analyze these results and provide your recommendation.`;
}

function parseActionItems(raw: string): ActionItems {
  let json: Record<string, unknown>;
  try {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : raw;
    json = JSON.parse(jsonStr.trim());
  } catch {
    return {
      recommendation: "improve",
      summary: "Could not parse action items from LLM response.",
      weaknesses: [],
      strengths: [],
      suggestedFocus: "Re-run the comparison for actionable recommendations.",
    };
  }

  const validRecs = new Set(["keep", "improve", "rewrite", "remove"]);
  const rec = typeof json.recommendation === "string" && validRecs.has(json.recommendation)
    ? json.recommendation as ActionItems["recommendation"]
    : "improve";

  return {
    recommendation: rec,
    summary: typeof json.summary === "string" ? json.summary : "",
    weaknesses: Array.isArray(json.weaknesses)
      ? json.weaknesses.filter((w): w is string => typeof w === "string")
      : [],
    strengths: Array.isArray(json.strengths)
      ? json.strengths.filter((s): s is string => typeof s === "string")
      : [],
    suggestedFocus: typeof json.suggestedFocus === "string" ? json.suggestedFocus : "",
  };
}

export async function generateActionItems(
  client: LlmClient,
  verdict: EvalVerdict,
  stats: ComparisonStats,
  cases: CaseResult[],
  skillContent: string,
): Promise<ActionItems> {
  const userPrompt = buildUserPrompt(verdict, stats, cases, skillContent);
  const { text } = await client.generate(SYSTEM_PROMPT, userPrompt);
  return parseActionItems(text);
}
