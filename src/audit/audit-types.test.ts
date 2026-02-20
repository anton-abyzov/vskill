import { describe, it, expect } from "vitest";
import {
  createDefaultAuditConfig,
  type AuditConfig,
  type AuditFinding,
  type AuditResult,
  type AuditSummary,
  type DataFlowTrace,
  type DataFlowStep,
  type AuditFile,
} from "./audit-types.js";

describe("audit-types", () => {
  describe("AuditFinding", () => {
    it("TC-001: is correctly importable and all fields are typed", () => {
      const finding: AuditFinding = {
        id: "AF-001",
        ruleId: "CI-001",
        severity: "critical",
        confidence: "high",
        category: "command-injection",
        message: "exec() call detected",
        filePath: "src/index.ts",
        line: 42,
        snippet: "  exec(command);",
        source: "tier1",
      };

      expect(finding.id).toBe("AF-001");
      expect(finding.ruleId).toBe("CI-001");
      expect(finding.severity).toBe("critical");
      expect(finding.confidence).toBe("high");
      expect(finding.category).toBe("command-injection");
      expect(finding.message).toBe("exec() call detected");
      expect(finding.filePath).toBe("src/index.ts");
      expect(finding.line).toBe(42);
      expect(finding.snippet).toBe("  exec(command);");
      expect(finding.source).toBe("tier1");
    });

    it("supports optional fields: column, endLine, dataFlow, suggestedFix", () => {
      const finding: AuditFinding = {
        id: "AF-002",
        ruleId: "SSRF-001",
        severity: "high",
        confidence: "medium",
        category: "ssrf",
        message: "SSRF via user-controlled URL",
        filePath: "src/api.ts",
        line: 10,
        column: 5,
        endLine: 12,
        snippet: "  fetch(url);",
        source: "llm",
        dataFlow: {
          steps: [
            {
              file: "src/api.ts",
              line: 5,
              description: "User input received",
              code: "const url = req.query.url;",
            },
          ],
        },
        suggestedFix: "Validate URL against an allowlist",
      };

      expect(finding.column).toBe(5);
      expect(finding.endLine).toBe(12);
      expect(finding.dataFlow?.steps).toHaveLength(1);
      expect(finding.suggestedFix).toBe("Validate URL against an allowlist");
    });
  });

  describe("AuditConfig", () => {
    it("TC-002: default values are correct", () => {
      const config = createDefaultAuditConfig();

      expect(config.excludePaths).toEqual([]);
      expect(config.severityThreshold).toBe("low");
      expect(config.maxFiles).toBe(500);
      expect(config.maxFileSize).toBe(100 * 1024);
      expect(config.tier1Only).toBe(false);
      expect(config.llmProvider).toBeNull();
      expect(config.llmTimeout).toBe(30_000);
      expect(config.llmConcurrency).toBe(5);
      expect(config.customPatterns).toEqual([]);
      expect(config.fix).toBe(false);
    });
  });

  describe("AuditResult", () => {
    it("contains all required fields for a complete result", () => {
      const result: AuditResult = {
        rootPath: "/project",
        startedAt: "2026-02-20T18:00:00Z",
        completedAt: "2026-02-20T18:00:05Z",
        durationMs: 5000,
        filesScanned: 100,
        filesWithFindings: 3,
        findings: [],
        summary: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          total: 0,
          score: 100,
          verdict: "PASS",
        },
        config: createDefaultAuditConfig(),
      };

      expect(result.rootPath).toBe("/project");
      expect(result.filesScanned).toBe(100);
      expect(result.summary.verdict).toBe("PASS");
      expect(result.summary.score).toBe(100);
    });
  });

  describe("DataFlowTrace", () => {
    it("has steps with file, line, description, code", () => {
      const trace: DataFlowTrace = {
        steps: [
          {
            file: "src/handler.ts",
            line: 10,
            description: "User input received from webhook",
            code: 'const msg = req.body.message;',
          },
          {
            file: "src/handler.ts",
            line: 15,
            description: "Passed to shell execution",
            code: 'exec(`echo ${msg}`);',
          },
        ],
      };

      expect(trace.steps).toHaveLength(2);
      expect(trace.steps[0].file).toBe("src/handler.ts");
      expect(trace.steps[1].line).toBe(15);
    });
  });

  describe("AuditFile", () => {
    it("represents a discovered file with path, content, sizeBytes", () => {
      const file: AuditFile = {
        path: "src/index.ts",
        content: "console.log('hello');",
        sizeBytes: 21,
      };

      expect(file.path).toBe("src/index.ts");
      expect(file.content).toBe("console.log('hello');");
      expect(file.sizeBytes).toBe(21);
    });
  });
});
