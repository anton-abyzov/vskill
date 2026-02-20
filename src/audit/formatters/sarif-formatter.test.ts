import { describe, it, expect } from "vitest";
import { formatSarif } from "./sarif-formatter.js";
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

describe("sarif-formatter", () => {
  it("TC-033: output matches SARIF v2.1.0 structure", () => {
    const output = formatSarif(makeResult());
    const parsed = JSON.parse(output);

    expect(parsed.$schema).toContain("sarif");
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs).toBeInstanceOf(Array);
    expect(parsed.runs).toHaveLength(1);
  });

  it("TC-034: tool information is correct", () => {
    const output = formatSarif(makeResult());
    const parsed = JSON.parse(output);
    const driver = parsed.runs[0].tool.driver;

    expect(driver.name).toBe("vskill-audit");
    expect(driver.informationUri).toContain("verified-skill.com");
  });

  it("TC-035: findings map to SARIF results with correct locations", () => {
    const result = makeResult({
      findings: [
        { id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high", category: "cmd", message: "exec call", filePath: "src/a.ts", line: 42, snippet: "code", source: "tier1" },
        { id: "AF-002", ruleId: "XSS-001", severity: "high", confidence: "high", category: "xss", message: "innerHTML", filePath: "src/b.ts", line: 10, snippet: "code", source: "tier1" },
      ],
      summary: { critical: 1, high: 1, medium: 0, low: 0, info: 0, total: 2, score: 60, verdict: "CONCERNS" },
    });

    const parsed = JSON.parse(formatSarif(result));
    const results = parsed.runs[0].results;

    expect(results).toHaveLength(2);
    expect(results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("src/a.ts");
    expect(results[0].locations[0].physicalLocation.region.startLine).toBe(42);
  });

  it("TC-036: severity maps to correct SARIF levels", () => {
    const result = makeResult({
      findings: [
        { id: "AF-001", ruleId: "R1", severity: "critical", confidence: "high", category: "c", message: "m", filePath: "f.ts", line: 1, snippet: "", source: "tier1" },
        { id: "AF-002", ruleId: "R2", severity: "high", confidence: "high", category: "c", message: "m", filePath: "f.ts", line: 2, snippet: "", source: "tier1" },
        { id: "AF-003", ruleId: "R3", severity: "medium", confidence: "high", category: "c", message: "m", filePath: "f.ts", line: 3, snippet: "", source: "tier1" },
        { id: "AF-004", ruleId: "R4", severity: "low", confidence: "high", category: "c", message: "m", filePath: "f.ts", line: 4, snippet: "", source: "tier1" },
        { id: "AF-005", ruleId: "R5", severity: "info", confidence: "high", category: "c", message: "m", filePath: "f.ts", line: 5, snippet: "", source: "tier1" },
      ],
      summary: { critical: 1, high: 1, medium: 1, low: 1, info: 1, total: 5, score: 49, verdict: "FAIL" },
    });

    const parsed = JSON.parse(formatSarif(result));
    const results = parsed.runs[0].results;

    expect(results[0].level).toBe("error");   // critical
    expect(results[1].level).toBe("error");   // high
    expect(results[2].level).toBe("warning"); // medium
    expect(results[3].level).toBe("note");    // low
    expect(results[4].level).toBe("note");    // info
  });
});
