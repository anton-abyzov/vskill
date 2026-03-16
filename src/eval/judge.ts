// ---------------------------------------------------------------------------
// Assertion-level LLM judge
// ---------------------------------------------------------------------------

import type { Assertion } from "./schema.js";
import type { LlmClient } from "./llm.js";
import type { McpDependency } from "./mcp-detector.js";

export interface AssertionResult {
  id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

const JUDGE_SYSTEM = `You are a binary assertion evaluator. Given an LLM output and an assertion, determine if the output satisfies the assertion. Respond with ONLY a JSON object: { "pass": boolean, "reasoning": "brief explanation" }`;

export function buildJudgeSystemPrompt(mcpDeps?: McpDependency[]): string {
  if (!mcpDeps || mcpDeps.length === 0) {
    return JUDGE_SYSTEM;
  }

  const serverList = mcpDeps.map((d) => d.server).join(", ");

  return `You are a binary assertion evaluator. Given an LLM output and an assertion, determine if the output satisfies the assertion.

IMPORTANT: This output was generated in MCP SIMULATION MODE. The following tools were simulated (not connected to real services): ${serverList}.
When evaluating assertions:
- A simulated tool call is valid if it names the correct tool and provides realistic parameters
- A simulated response is valid if it contains plausible data (realistic IDs, timestamps, content)
- Do NOT fail assertions just because data is simulated rather than real

Respond with ONLY a JSON object: { "pass": boolean, "reasoning": "brief explanation" }`;
}

export async function judgeAssertion(
  output: string,
  assertion: Assertion,
  client: LlmClient,
  judgeClientOrMcpDeps?: LlmClient | McpDependency[],
  mcpDeps?: McpDependency[],
): Promise<AssertionResult> {
  // Support both old signature (client, mcpDeps?) and new (client, judgeClient?, mcpDeps?)
  let effectiveJudgeClient: LlmClient;
  let effectiveMcpDeps: McpDependency[] | undefined;

  if (Array.isArray(judgeClientOrMcpDeps)) {
    // Old-style call: judgeAssertion(output, assertion, client, mcpDeps)
    effectiveJudgeClient = client;
    effectiveMcpDeps = judgeClientOrMcpDeps;
  } else if (judgeClientOrMcpDeps && typeof judgeClientOrMcpDeps === "object" && "generate" in judgeClientOrMcpDeps) {
    // New-style call: judgeAssertion(output, assertion, client, judgeClient, mcpDeps?)
    effectiveJudgeClient = judgeClientOrMcpDeps;
    effectiveMcpDeps = mcpDeps;
  } else {
    effectiveJudgeClient = client;
    effectiveMcpDeps = mcpDeps;
  }

  const systemPrompt = buildJudgeSystemPrompt(effectiveMcpDeps);

  const userPrompt = `## LLM Output
${output}

## Assertion to Verify
${assertion.text}

Does the LLM output satisfy this assertion? Respond with JSON only: { "pass": boolean, "reasoning": "..." }`;

  const { text: raw } = await effectiveJudgeClient.generate(systemPrompt, userPrompt);

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
