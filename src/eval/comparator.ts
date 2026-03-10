// ---------------------------------------------------------------------------
// comparator.ts -- blind A/B comparison (with/without skill)
// ---------------------------------------------------------------------------

import type { LlmClient } from "./llm.js";
import { buildEvalSystemPrompt, buildBaselineSystemPrompt } from "./prompt-builder.js";

export interface ComparisonOutput {
  skillOutput: string;
  skillDurationMs: number;
  skillTokens: number | null;
  baselineOutput: string;
  baselineDurationMs: number;
  baselineTokens: number | null;
}

export interface ComparisonScore {
  contentScoreA: number;
  structureScoreA: number;
  contentScoreB: number;
  structureScoreB: number;
  winner: "first" | "second" | "tie";
}

export interface ComparisonResult {
  prompt: string;
  skillOutput: string;
  skillDurationMs: number;
  skillTokens: number | null;
  baselineOutput: string;
  baselineDurationMs: number;
  baselineTokens: number | null;
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
  winner: "skill" | "baseline" | "tie";
}

const COMPARATOR_SYSTEM_PROMPT = `You are a blind quality evaluator. You will receive two AI assistant responses labeled "Response A" and "Response B". You do NOT know which response used a skill and which did not.

Evaluate each response on two dimensions:
1. **Content** (1-5): Correctness, completeness, accuracy, relevance to the prompt
2. **Structure** (1-5): Organization, formatting, readability, logical flow

Then decide which is better overall, or if they are tied.

Respond with ONLY valid JSON:
{
  "content_score_a": <1-5>,
  "structure_score_a": <1-5>,
  "content_score_b": <1-5>,
  "structure_score_b": <1-5>,
  "winner": "first" | "second" | "tie",
  "reasoning": "<brief explanation>"
}`;

export async function generateComparisonOutputs(
  prompt: string,
  skillContent: string,
  client: LlmClient,
): Promise<ComparisonOutput> {
  const skillSystemPrompt = buildEvalSystemPrompt(skillContent);
  const baselineSystemPrompt = buildBaselineSystemPrompt();

  // Run sequentially (claude-cli can only handle one at a time)
  const skillResult = await client.generate(skillSystemPrompt, prompt);
  const baselineResult = await client.generate(baselineSystemPrompt, prompt);

  const totalTokens = (r: typeof skillResult) =>
    r.inputTokens != null && r.outputTokens != null ? r.inputTokens + r.outputTokens : null;

  return {
    skillOutput: skillResult.text,
    skillDurationMs: skillResult.durationMs,
    skillTokens: totalTokens(skillResult),
    baselineOutput: baselineResult.text,
    baselineDurationMs: baselineResult.durationMs,
    baselineTokens: totalTokens(baselineResult),
  };
}

export async function scoreComparison(
  outputA: string,
  outputB: string,
  prompt: string,
  client: LlmClient,
): Promise<ComparisonScore> {
  const userPrompt = `## Original Prompt
${prompt}

## Response A
${outputA}

## Response B
${outputB}

Evaluate both responses.`;

  const { text: response } = await client.generate(COMPARATOR_SYSTEM_PROMPT, userPrompt);

  // Parse JSON from response (may be in code fence or plain)
  let json: Record<string, unknown>;
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    json = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error(`Failed to parse comparison response as JSON: ${response.slice(0, 200)}`);
  }

  return {
    contentScoreA: clampScore(json.content_score_a),
    structureScoreA: clampScore(json.structure_score_a),
    contentScoreB: clampScore(json.content_score_b),
    structureScoreB: clampScore(json.structure_score_b),
    winner: json.winner === "first" || json.winner === "second" || json.winner === "tie"
      ? json.winner
      : "tie",
  };
}

export async function runComparison(
  prompt: string,
  skillContent: string,
  client: LlmClient,
): Promise<ComparisonResult> {
  const outputs = await generateComparisonOutputs(prompt, skillContent, client);

  // Randomize order for blind comparison
  const skillIsA = Math.random() < 0.5;
  const outputA = skillIsA ? outputs.skillOutput : outputs.baselineOutput;
  const outputB = skillIsA ? outputs.baselineOutput : outputs.skillOutput;

  const scores = await scoreComparison(outputA, outputB, prompt, client);

  // Map scores back to skill/baseline
  const skillContentScore = skillIsA ? scores.contentScoreA : scores.contentScoreB;
  const skillStructureScore = skillIsA ? scores.structureScoreA : scores.structureScoreB;
  const baselineContentScore = skillIsA ? scores.contentScoreB : scores.contentScoreA;
  const baselineStructureScore = skillIsA ? scores.structureScoreB : scores.structureScoreA;

  // Map winner back
  let winner: "skill" | "baseline" | "tie";
  if (scores.winner === "tie") {
    winner = "tie";
  } else if (scores.winner === "first") {
    winner = skillIsA ? "skill" : "baseline";
  } else {
    winner = skillIsA ? "baseline" : "skill";
  }

  return {
    prompt,
    skillOutput: outputs.skillOutput,
    skillDurationMs: outputs.skillDurationMs,
    skillTokens: outputs.skillTokens,
    baselineOutput: outputs.baselineOutput,
    baselineDurationMs: outputs.baselineDurationMs,
    baselineTokens: outputs.baselineTokens,
    skillContentScore,
    skillStructureScore,
    baselineContentScore,
    baselineStructureScore,
    winner,
  };
}

function clampScore(val: unknown): number {
  const n = Number(val);
  if (isNaN(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}
