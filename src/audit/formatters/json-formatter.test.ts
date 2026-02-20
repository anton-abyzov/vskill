import { describe, it, expect } from "vitest";
import { formatJson } from "./json-formatter.js";
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

describe("json-formatter", () => {
  it("TC-030: output is valid JSON", () => {
    const output = formatJson(makeResult());
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("TC-031: all findings are present in output", () => {
    const findings = Array.from({ length: 5 }, (_, i) => ({
      id: `AF-${i}`, ruleId: `R-${i}`, severity: "high" as const, confidence: "high" as const,
      category: "test", message: `msg ${i}`, filePath: `f${i}.ts`, line: i + 1,
      snippet: "code", source: "tier1" as const,
    }));
    const output = formatJson(makeResult({ findings, summary: { critical: 0, high: 5, medium: 0, low: 0, info: 0, total: 5, score: 25, verdict: "FAIL" } }));
    const parsed = JSON.parse(output);
    expect(parsed.findings).toHaveLength(5);
  });

  it("TC-032: summary statistics are included", () => {
    const output = formatJson(makeResult({
      summary: { critical: 1, high: 2, medium: 3, low: 4, info: 5, total: 15, score: 50, verdict: "CONCERNS" },
    }));
    const parsed = JSON.parse(output);
    expect(parsed.summary.critical).toBe(1);
    expect(parsed.summary.high).toBe(2);
    expect(parsed.summary.medium).toBe(3);
    expect(parsed.summary.low).toBe(4);
    expect(parsed.summary.info).toBe(5);
    expect(parsed.summary.total).toBe(15);
  });
});
