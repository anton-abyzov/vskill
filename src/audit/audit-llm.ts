/**
 * LLM-based security analysis engine.
 *
 * Performs deeper analysis on Tier 1 flagged files using an LLM
 * (via subprocess). Traces data flows and identifies complex
 * vulnerabilities that regex patterns alone cannot detect.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AuditConfig,
  AuditFile,
  AuditFinding,
  DataFlowTrace,
} from "./audit-types.js";

const execFileAsync = promisify(execFile);

/**
 * Build a security analysis prompt for the LLM.
 */
export function buildLlmPrompt(
  file: AuditFile,
  tier1Findings: AuditFinding[],
): string {
  const findingSummaries = tier1Findings
    .map((f) => `  - [${f.ruleId}] ${f.severity} (${f.category}): ${f.message} (line ${f.line})`)
    .join("\n");

  return `Analyze this file for security vulnerabilities. Focus on data flow from user input to dangerous sinks.

File: ${file.path}
Tier 1 findings:
${findingSummaries}

Source code:
\`\`\`
${file.content}
\`\`\`

Respond with JSON only:
{
  "findings": [{
    "ruleId": "LLM-XXX-NNN",
    "severity": "critical|high|medium|low|info",
    "confidence": "high|medium|low",
    "category": "category-name",
    "message": "description",
    "line": <number>,
    "dataFlow": {
      "steps": [{"file": "path", "line": <number>, "description": "what happens", "code": "snippet"}]
    },
    "suggestedFix": "how to fix"
  }]
}`;
}

/**
 * Parse the LLM's JSON response into AuditFinding objects.
 */
export function parseLlmResponse(
  response: string,
  filePath: string,
): AuditFinding[] {
  try {
    // Extract JSON from response (may contain markdown wrapping)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[0]);
    if (!data.findings || !Array.isArray(data.findings)) return [];

    let counter = 0;
    return data.findings.map((f: Record<string, unknown>) => {
      counter++;
      const finding: AuditFinding = {
        id: `LLM-${String(counter).padStart(3, "0")}`,
        ruleId: (f.ruleId as string) || "LLM-UNKNOWN",
        severity: (f.severity as AuditFinding["severity"]) || "medium",
        confidence: (f.confidence as AuditFinding["confidence"]) || "medium",
        category: (f.category as string) || "unknown",
        message: (f.message as string) || "",
        filePath,
        line: (f.line as number) || 1,
        snippet: "",
        source: "llm",
      };

      // Parse data flow if present
      if (f.dataFlow && typeof f.dataFlow === "object") {
        const df = f.dataFlow as Record<string, unknown>;
        if (Array.isArray(df.steps)) {
          finding.dataFlow = {
            steps: df.steps.map((s: Record<string, unknown>) => ({
              file: (s.file as string) || filePath,
              line: (s.line as number) || 1,
              description: (s.description as string) || "",
              code: (s.code as string) || "",
            })),
          } satisfies DataFlowTrace;
        }
      }

      // Parse suggested fix
      if (f.suggestedFix && typeof f.suggestedFix === "string") {
        finding.suggestedFix = f.suggestedFix;
      }

      return finding;
    });
  } catch {
    return [];
  }
}

/**
 * Run LLM analysis on flagged files.
 *
 * @param files - Files that had Tier 1 findings
 * @param tier1Findings - All Tier 1 findings (to provide context)
 * @param config - Audit configuration
 * @returns Additional findings from LLM analysis
 */
export async function runLlmAnalysis(
  files: AuditFile[],
  tier1Findings: AuditFinding[],
  config: AuditConfig,
): Promise<AuditFinding[]> {
  if (config.tier1Only || files.length === 0) return [];

  // Group Tier 1 findings by file
  const findingsByFile = new Map<string, AuditFinding[]>();
  for (const f of tier1Findings) {
    const group = findingsByFile.get(f.filePath) || [];
    group.push(f);
    findingsByFile.set(f.filePath, group);
  }

  const allLlmFindings: AuditFinding[] = [];

  // Process files with concurrency limit
  const concurrency = config.llmConcurrency;
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const promises = batch.map(async (file) => {
      const fileFindings = findingsByFile.get(file.path) || [];
      const prompt = buildLlmPrompt(file, fileFindings);

      try {
        const { stdout } = await execFileAsync(
          config.llmProvider || "claude",
          ["--print", prompt],
          { timeout: config.llmTimeout },
        );
        return parseLlmResponse(stdout, file.path);
      } catch {
        // Graceful fallback: LLM unavailable or timed out
        return [];
      }
    });

    const results = await Promise.all(promises);
    for (const findings of results) {
      allLlmFindings.push(...findings);
    }
  }

  return allLlmFindings;
}
