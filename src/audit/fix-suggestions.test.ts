import { describe, it, expect } from "vitest";
import { FIX_SUGGESTIONS, attachFixSuggestions } from "./fix-suggestions.js";
import { AUDIT_PATTERNS } from "./audit-patterns.js";
import type { AuditFinding } from "./audit-types.js";

describe("fix-suggestions", () => {
  it("TC-047: every audit pattern ID has a fix suggestion", () => {
    for (const pattern of AUDIT_PATTERNS) {
      expect(
        FIX_SUGGESTIONS[pattern.id],
        `Missing fix suggestion for pattern ${pattern.id}`,
      ).toBeDefined();
      expect(FIX_SUGGESTIONS[pattern.id].length).toBeGreaterThan(0);
    }
  });

  it("TC-048: fix suggestion is attached to finding when fix=true", () => {
    const findings: AuditFinding[] = [
      {
        id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high",
        category: "command-injection", message: "exec() call",
        filePath: "a.ts", line: 1, snippet: "code", source: "tier1",
      },
    ];

    const result = attachFixSuggestions(findings, true);

    expect(result[0].suggestedFix).toBeDefined();
    expect(result[0].suggestedFix!.length).toBeGreaterThan(0);
  });

  it("TC-049: fix suggestion is absent when fix=false", () => {
    const findings: AuditFinding[] = [
      {
        id: "AF-001", ruleId: "CI-001", severity: "critical", confidence: "high",
        category: "command-injection", message: "exec() call",
        filePath: "a.ts", line: 1, snippet: "code", source: "tier1",
      },
    ];

    const result = attachFixSuggestions(findings, false);

    expect(result[0].suggestedFix).toBeUndefined();
  });
});
