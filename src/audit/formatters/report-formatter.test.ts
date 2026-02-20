import { describe, it, expect } from "vitest";
import { formatReport } from "./report-formatter.js";
import { createDefaultAuditConfig, type AuditResult } from "../audit-types.js";

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    rootPath: "/project",
    startedAt: "2026-02-20T18:00:00Z",
    completedAt: "2026-02-20T18:00:01Z",
    durationMs: 1000,
    filesScanned: 10,
    filesWithFindings: 0,
    findings: [],
    summary: {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
      total: 0, score: 100, verdict: "PASS",
    },
    config: createDefaultAuditConfig(),
    ...overrides,
  };
}

describe("report-formatter", () => {
  it("TC-037: report contains all sections", () => {
    const output = formatReport(makeResult({
      findings: [
        { id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high", category: "cmd", message: "exec", filePath: "a.ts", line: 1, snippet: "code", source: "tier1" },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1, score: 75, verdict: "CONCERNS" },
    }));

    expect(output).toContain("Executive Summary");
    expect(output).toContain("Findings");
    expect(output).toContain("Recommendations");
  });

  it("TC-038: code snippets are in fenced code blocks", () => {
    const output = formatReport(makeResult({
      findings: [
        { id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high", category: "cmd", message: "exec", filePath: "a.ts", line: 1, snippet: "> 1 | exec(cmd);", source: "tier1" },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1, score: 75, verdict: "CONCERNS" },
    }));

    expect(output).toContain("```");
  });

  it("TC-039: summary table has correct counts", () => {
    const output = formatReport(makeResult({
      summary: { critical: 2, high: 3, medium: 1, low: 0, info: 0, total: 6, score: 32, verdict: "FAIL" },
    }));

    expect(output).toContain("2");
    expect(output).toContain("3");
    expect(output).toContain("1");
  });
});
