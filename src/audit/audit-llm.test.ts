import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLlmPrompt, parseLlmResponse, runLlmAnalysis } from "./audit-llm.js";
import { createDefaultAuditConfig, type AuditFile, type AuditFinding } from "./audit-types.js";

describe("audit-llm", () => {
  describe("buildLlmPrompt", () => {
    it("TC-040: builds correct prompt with file content and Tier 1 findings", () => {
      const file: AuditFile = {
        path: "src/handler.ts",
        content: 'const msg = req.body.message;\nexec(`echo ${msg}`);',
        sizeBytes: 50,
      };
      const findings: AuditFinding[] = [
        {
          id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high",
          category: "command-injection", message: "exec() call detected",
          filePath: "src/handler.ts", line: 2, snippet: "exec(`echo ${msg}`);",
          source: "tier1",
        },
      ];

      const prompt = buildLlmPrompt(file, findings);

      expect(prompt).toContain("src/handler.ts");
      expect(prompt).toContain("exec(`echo ${msg}`)");
      expect(prompt).toContain("CI-001");
      expect(prompt).toContain("command-injection");
    });
  });

  describe("parseLlmResponse", () => {
    it("TC-041: parses valid LLM JSON response", () => {
      const response = JSON.stringify({
        findings: [
          {
            ruleId: "LLM-CI-001",
            severity: "critical",
            confidence: "high",
            category: "command-injection",
            message: "Command injection via webhook payload",
            line: 2,
            dataFlow: {
              steps: [
                { file: "src/handler.ts", line: 1, description: "User input", code: "const msg = req.body.message;" },
                { file: "src/handler.ts", line: 2, description: "Shell exec", code: "exec(`echo ${msg}`);" },
              ],
            },
            suggestedFix: "Use execFile with array args instead of exec with template",
          },
        ],
      });

      const parsed = parseLlmResponse(response, "src/handler.ts");

      expect(parsed).toHaveLength(1);
      expect(parsed[0].ruleId).toBe("LLM-CI-001");
      expect(parsed[0].source).toBe("llm");
      expect(parsed[0].filePath).toBe("src/handler.ts");
    });

    it("TC-042: returns empty array on invalid JSON", () => {
      const parsed = parseLlmResponse("not json at all", "src/file.ts");
      expect(parsed).toHaveLength(0);
    });

    it("TC-045: data flow trace is parsed from LLM response", () => {
      const response = JSON.stringify({
        findings: [{
          ruleId: "LLM-SSRF-001",
          severity: "high",
          confidence: "high",
          category: "ssrf",
          message: "SSRF via user URL",
          line: 10,
          dataFlow: {
            steps: [
              { file: "src/api.ts", line: 5, description: "Input received", code: "const url = req.query.url;" },
              { file: "src/api.ts", line: 10, description: "Fetch called", code: "fetch(url);" },
            ],
          },
        }],
      });

      const parsed = parseLlmResponse(response, "src/api.ts");

      expect(parsed[0].dataFlow).toBeDefined();
      expect(parsed[0].dataFlow!.steps).toHaveLength(2);
      expect(parsed[0].dataFlow!.steps[0].file).toBe("src/api.ts");
      expect(parsed[0].dataFlow!.steps[1].line).toBe(10);
    });

    it("TC-046: missing data flow is handled gracefully", () => {
      const response = JSON.stringify({
        findings: [{
          ruleId: "LLM-XSS-001",
          severity: "high",
          confidence: "medium",
          category: "xss",
          message: "Potential XSS",
          line: 5,
        }],
      });

      const parsed = parseLlmResponse(response, "src/page.ts");

      expect(parsed[0].dataFlow).toBeUndefined();
    });
  });

  describe("runLlmAnalysis", () => {
    it("TC-043: skips LLM when tier1Only is true", async () => {
      const config = createDefaultAuditConfig();
      config.tier1Only = true;

      const result = await runLlmAnalysis([], [], config);

      expect(result).toHaveLength(0);
    });

    it("TC-044: returns empty when no flagged files", async () => {
      const config = createDefaultAuditConfig();
      const result = await runLlmAnalysis([], [], config);
      expect(result).toHaveLength(0);
    });
  });
});
