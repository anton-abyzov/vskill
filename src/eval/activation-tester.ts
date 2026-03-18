// ---------------------------------------------------------------------------
// activation-tester.ts -- test SKILL.md description auto-activation quality
// ---------------------------------------------------------------------------

import type { LlmClient } from "./llm.js";

export interface SkillMeta {
  name: string;
  tags: string[];
}

export interface ActivationPrompt {
  prompt: string;
  expected: "should_activate" | "should_not_activate" | "auto";
}

export interface ActivationResult {
  prompt: string;
  expected: "should_activate" | "should_not_activate";
  activate: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  classification: "TP" | "TN" | "FP" | "FN";
  autoClassified?: boolean;
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
  autoClassifiedCount: number;
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

const CLASSIFY_SYSTEM_PROMPT = `You decide if a user prompt is related to a specific AI skill.
Given the skill name and tags, determine if the user prompt is something this skill should handle.
Respond with ONLY valid JSON:
{"related": true/false}`;

// ---------------------------------------------------------------------------
// Phase 1: Auto-classify expected behavior from skill name + tags
// ---------------------------------------------------------------------------

async function classifyExpectation(
  meta: SkillMeta,
  prompt: string,
  client: LlmClient,
): Promise<"should_activate" | "should_not_activate"> {
  try {
    const userPrompt = `Skill: ${meta.name}\nTags: ${meta.tags.join(", ")}\n\nUser prompt: ${prompt}`;
    const { text } = await client.generate(CLASSIFY_SYSTEM_PROMPT, userPrompt);
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const json = JSON.parse(jsonMatch[1]!.trim());
    return json.related ? "should_activate" : "should_not_activate";
  } catch {
    return "should_activate";
  }
}

// ---------------------------------------------------------------------------
// Resolve prompts: auto → should_activate / should_not_activate
// ---------------------------------------------------------------------------

interface ResolvedPrompt {
  prompt: string;
  expected: "should_activate" | "should_not_activate";
  autoClassified: boolean;
}

async function resolvePrompts(
  prompts: ActivationPrompt[],
  client: LlmClient,
  meta?: SkillMeta,
  onProgress?: (phase: "classifying", index: number, total: number) => void,
): Promise<ResolvedPrompt[]> {
  const resolved: ResolvedPrompt[] = [];
  const autoTotal = meta ? prompts.filter((p) => p.expected === "auto").length : 0;
  let autoIndex = 0;
  for (const p of prompts) {
    if (p.expected === "auto") {
      if (meta) {
        const expected = await classifyExpectation(meta, p.prompt, client);
        onProgress?.("classifying", ++autoIndex, autoTotal);
        resolved.push({ prompt: p.prompt, expected, autoClassified: true });
      } else {
        resolved.push({ prompt: p.prompt, expected: "should_activate", autoClassified: true });
      }
    } else {
      resolved.push({ prompt: p.prompt, expected: p.expected, autoClassified: false });
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Phase 2: Evaluate activation against skill description
// ---------------------------------------------------------------------------

export async function testActivation(
  skillDescription: string,
  prompts: ActivationPrompt[],
  client: LlmClient,
  onResult?: (result: ActivationResult) => void,
  meta?: SkillMeta,
  onProgress?: (phase: "classifying", index: number, total: number) => void,
): Promise<ActivationSummary> {
  // Phase 1: resolve auto expectations
  const resolved = await resolvePrompts(prompts, client, meta, onProgress);

  // Phase 2: evaluate each prompt against description
  const results: ActivationResult[] = [];

  for (const p of resolved) {
    const userPrompt = `## Skill Description
${skillDescription}

## User Prompt
${p.prompt}

Would this user prompt trigger this skill?`;

    try {
      const { text: response } = await client.generate(ACTIVATION_SYSTEM_PROMPT, userPrompt);
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
        autoClassified: p.autoClassified,
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
        autoClassified: p.autoClassified,
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
    autoClassifiedCount: results.filter((r) => r.autoClassified).length,
  };
}
