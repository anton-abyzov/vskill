/**
 * SARIF v2.1.0 formatter — generates SARIF-compliant JSON for CI tools.
 *
 * Enables integration with GitHub Code Scanning, VS Code SARIF Viewer,
 * and other standard static analysis result consumers.
 */

import type { AuditResult, AuditFinding, Severity } from "../audit-types.js";

/** Map severity to SARIF result level */
function toSarifLevel(severity: Severity): string {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "note";
  }
}

/**
 * Format an AuditResult as SARIF v2.1.0 JSON string.
 */
export function formatSarif(result: AuditResult): string {
  // Collect unique rules from findings
  const rulesMap = new Map<string, { id: string; shortDescription: string; category: string }>();
  for (const f of result.findings) {
    if (!rulesMap.has(f.ruleId)) {
      rulesMap.set(f.ruleId, {
        id: f.ruleId,
        shortDescription: f.message,
        category: f.category,
      });
    }
  }

  const rules = Array.from(rulesMap.values()).map((r) => ({
    id: r.id,
    name: r.id,
    shortDescription: { text: r.shortDescription },
    properties: { category: r.category },
  }));

  const results = result.findings.map((f) => ({
    ruleId: f.ruleId,
    level: toSarifLevel(f.severity as Severity),
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.filePath },
          region: {
            startLine: f.line,
            ...(f.column ? { startColumn: f.column } : {}),
            ...(f.endLine ? { endLine: f.endLine } : {}),
          },
        },
      },
    ],
    properties: {
      confidence: f.confidence,
      source: f.source,
    },
  }));

  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "vskill-audit",
            informationUri: "https://verified-skill.com",
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: true,
            startTimeUtc: result.startedAt,
            endTimeUtc: result.completedAt,
          },
        ],
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
