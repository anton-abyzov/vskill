/**
 * Tier 2 Scanner — LLM-based security analysis via Workers AI.
 *
 * Takes SKILL.md content + Tier 1 findings and uses Cloudflare Workers AI
 * (Llama 3.1 70B) to provide a semantic security assessment with a score,
 * verdict, and rationale.
 */

import type { SecurityFinding, Tier2Result, ScanVerdict } from './types.js';

/** The Workers AI model used for Tier 2 scanning */
const TIER2_MODEL = '@cf/meta/llama-3.1-70b-instruct';

/** Minimum interface for the Workers AI binding */
export interface AIBinding {
  run(
    model: string,
    input: { messages: Array<{ role: string; content: string }> },
  ): Promise<{ response?: string }>;
}

/**
 * Builds the system prompt for the Tier 2 LLM judge.
 */
function buildSystemPrompt(): string {
  return `You are a security auditor for AI agent skill packages. Your job is to analyze SKILL.md files (which define AI agent capabilities) for security risks.

You will receive:
1. The full SKILL.md content
2. Findings from an automated pattern-based scanner (Tier 1)

Your task:
- Assess the OVERALL security risk of this skill package
- Consider both the Tier 1 findings AND your own semantic analysis
- Look for subtle risks the pattern scanner might miss (social engineering, indirect prompt injection, data exfiltration through side channels, etc.)
- Provide a score from 0 (most dangerous) to 100 (completely safe)

Respond ONLY with valid JSON in this exact format:
{
  "score": <number 0-100>,
  "verdict": "<PASS|CONCERNS|FAIL>",
  "rationale": "<2-3 sentence explanation>"
}

Scoring guide:
- 80-100: PASS — Safe, no significant concerns
- 40-79: CONCERNS — Some risks worth manual review
- 0-39: FAIL — Significant security risks detected

Be strict. When in doubt, err on the side of caution.`;
}

/**
 * Builds the user message containing the content and Tier 1 findings.
 */
function buildUserMessage(content: string, tier1Findings: SecurityFinding[]): string {
  const findingsSummary =
    tier1Findings.length > 0
      ? tier1Findings
          .map(
            (f) =>
              `- [${f.severity.toUpperCase()}] ${f.category}: ${f.message} (line ${f.line ?? '?'})`,
          )
          .join('\n')
      : 'No findings from automated scan.';

  return `## SKILL.md Content

\`\`\`markdown
${content}
\`\`\`

## Tier 1 Scanner Findings

${findingsSummary}

Analyze this skill package and respond with the JSON assessment.`;
}

/**
 * Parses the LLM response into a structured Tier2Result.
 * Handles cases where the LLM wraps JSON in markdown code fences.
 */
function parseResponse(raw: string): Omit<Tier2Result, 'model'> {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 0;

    const validVerdicts: ScanVerdict[] = ['PASS', 'CONCERNS', 'FAIL'];
    const verdict: ScanVerdict = validVerdicts.includes(parsed.verdict)
      ? parsed.verdict
      : score >= 80
        ? 'PASS'
        : score >= 40
          ? 'CONCERNS'
          : 'FAIL';

    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided.';

    return { score, verdict, rationale };
  } catch {
    // If parsing fails, return a conservative FAIL
    return {
      score: 0,
      verdict: 'FAIL',
      rationale: `Failed to parse LLM response: ${raw.slice(0, 200)}`,
    };
  }
}

/**
 * Runs Tier 2 LLM-based security analysis.
 *
 * @param content - The SKILL.md file content
 * @param tier1Findings - Findings from the Tier 1 pattern scanner
 * @param ai - The Workers AI binding (env.AI)
 * @returns Tier2Result with score, verdict, rationale, and model
 */
export async function runTier2Scan(
  content: string,
  tier1Findings: SecurityFinding[],
  ai: AIBinding,
): Promise<Tier2Result> {
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(content, tier1Findings);

  try {
    const result = await ai.run(TIER2_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const responseText = result.response ?? '';
    const parsed = parseResponse(responseText);

    return {
      ...parsed,
      model: TIER2_MODEL,
    };
  } catch (error) {
    // On API failure, return conservative FAIL
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      score: 0,
      verdict: 'FAIL',
      rationale: `Tier 2 scan failed: ${errorMsg}`,
      model: TIER2_MODEL,
    };
  }
}
