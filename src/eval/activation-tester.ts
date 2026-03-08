// ---------------------------------------------------------------------------
// activation-tester.ts -- test SKILL.md description auto-activation quality
// ---------------------------------------------------------------------------

import type { LlmClient } from "./llm.js";

export interface ActivationPrompt {
  prompt: string;
  expected: "should_activate" | "should_not_activate";
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

const ACTIVATION_SYSTEM_PROMPT = `You are evaluating whether a user prompt would trigger an AI skill based on its description.

Given the skill description and a user prompt, determine:
1. Would this prompt trigger this skill? (yes/no)
2. How confident are you? (high/medium/low)
3. Brief reasoning

Respond with ONLY valid JSON:
{
  "activate": true/false,
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation"
}`;

export async function testActivation(
  skillDescription: string,
  prompts: ActivationPrompt[],
  client: LlmClient,
  onResult?: (result: ActivationResult) => void,
): Promise<ActivationSummary> {
  const results: ActivationResult[] = [];

  for (const p of prompts) {
    const userPrompt = `## Skill Description
${skillDescription}

## User Prompt
${p.prompt}

Would this user prompt trigger this skill?`;

    try {
      const response = await client.generate(ACTIVATION_SYSTEM_PROMPT, userPrompt);
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
      const json = JSON.parse(jsonMatch[1]!.trim());

      const activate = !!json.activate;
      const confidence = ["high", "medium", "low"].includes(json.confidence)
        ? (json.confidence as "high" | "medium" | "low")
        : "low";

      const classification = classifyResult(p.expected, activate);

      const result: ActivationResult = {
        prompt: p.prompt,
        expected: p.expected,
        activate,
        confidence,
        reasoning: String(json.reasoning || ""),
        classification,
      };
      results.push(result);
      onResult?.(result);
    } catch (err) {
      const result: ActivationResult = {
        prompt: p.prompt,
        expected: p.expected,
        activate: false,
        confidence: "low",
        reasoning: `Error: ${err instanceof Error ? err.message : String(err)}`,
        classification: p.expected === "should_activate" ? "FN" : "TN",
      };
      results.push(result);
      onResult?.(result);
    }
  }

  return computeSummary(results);
}

function classifyResult(
  expected: "should_activate" | "should_not_activate",
  actual: boolean,
): "TP" | "TN" | "FP" | "FN" {
  if (expected === "should_activate" && actual) return "TP";
  if (expected === "should_activate" && !actual) return "FN";
  if (expected === "should_not_activate" && !actual) return "TN";
  return "FP";
}

function computeSummary(results: ActivationResult[]): ActivationSummary {
  const tp = results.filter((r) => r.classification === "TP").length;
  const tn = results.filter((r) => r.classification === "TN").length;
  const fp = results.filter((r) => r.classification === "FP").length;
  const fn = results.filter((r) => r.classification === "FN").length;
  const total = results.length;

  return {
    results,
    precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    recall: tp + fn > 0 ? tp / (tp + fn) : 0,
    reliability: total > 0 ? (tp + tn) / total : 0,
    total,
    tp,
    tn,
    fp,
    fn,
  };
}
