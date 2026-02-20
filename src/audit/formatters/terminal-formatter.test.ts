import { describe, it, expect } from "vitest";
import { formatTerminal } from "./terminal-formatter.js";
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

describe("terminal-formatter", () => {
  it("TC-027: formats empty results correctly", () => {
    const output = formatTerminal(makeResult());
    expect(output).toContain("No security issues found");
  });

  it("TC-028: groups findings by file", () => {
    const output = formatTerminal(makeResult({
      filesWithFindings: 3,
      findings: [
        { id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high", category: "cmd", message: "exec", filePath: "src/a.ts", line: 1, snippet: "code", source: "tier1" },
        { id: "AF-002", ruleId: "XSS-001", severity: "high", confidence: "high", category: "xss", message: "xss", filePath: "src/b.ts", line: 2, snippet: "code", source: "tier1" },
        { id: "AF-003", ruleId: "SQLI-001", severity: "critical", confidence: "high", category: "sql", message: "sql", filePath: "src/c.ts", line: 3, snippet: "code", source: "tier1" },
      ],
      summary: { critical: 2, high: 1, medium: 0, low: 0, info: 0, total: 3, score: 35, verdict: "FAIL" },
    }));

    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
    expect(output).toContain("src/c.ts");
  });

  it("TC-029: includes code snippets", () => {
    const output = formatTerminal(makeResult({
      filesWithFindings: 1,
      findings: [
        { id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high", category: "cmd", message: "exec call", filePath: "src/a.ts", line: 1, snippet: "> 1 | exec(command);", source: "tier1" },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0, total: 1, score: 75, verdict: "CONCERNS" },
    }));

    expect(output).toContain("exec(command)");
  });
});
