// ---------------------------------------------------------------------------
// Assertion-level LLM judge
// ---------------------------------------------------------------------------

import type { Assertion } from "./schema.js";
import type { LlmClient } from "./llm.js";

export interface AssertionResult {
  id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

const JUDGE_SYSTEM = `You are a binary assertion evaluator. Given an LLM output and an assertion, determine if the output satisfies the assertion. Respond with ONLY a JSON object: { "pass": boolean, "reasoning": "brief explanation" }`;

export async function judgeAssertion(
  output: string,
  assertion: Assertion,
  client: LlmClient,
): Promise<AssertionResult> {
  const userPrompt = `## LLM Output
${output}

## Assertion to Verify
${assertion.text}

Does the LLM output satisfy this assertion? Respond with JSON only: { "pass": boolean, "reasoning": "..." }`;

  const raw = await client.generate(JUDGE_SYSTEM, userPrompt);

  const parsed = parseJudgeResponse(raw);

  return {
    id: assertion.id,
    text: assertion.text,
    pass: parsed.pass,
    reasoning: parsed.reasoning,
  };
}

function parseJudgeResponse(raw: string): { pass: boolean; reasoning: string } {
  // Try to extract JSON from code fence first
  const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : raw;

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.pass !== "boolean") {
      throw new Error("missing pass field");
    }
    return {
      pass: parsed.pass,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    throw new Error(
      `Invalid judge output: expected JSON with { pass, reasoning }, got: ${raw.slice(0, 100)}`,
    );
  }
}
