import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { discoverAuditFiles } from "./file-discovery.js";
import { runAuditScan } from "./audit-scanner.js";
import { createDefaultAuditConfig } from "./audit-types.js";
import { formatJson } from "./formatters/json-formatter.js";
import { formatSarif } from "./formatters/sarif-formatter.js";
import { attachFixSuggestions } from "./fix-suggestions.js";
import { loadAuditConfig } from "./config.js";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

describe("audit integration", () => {
  it("TC-054: clean project produces PASS verdict", async () => {
    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(join(FIXTURES, "clean-project"), config);
    const result = runAuditScan(files, config);

    expect(result.findings).toHaveLength(0);
    expect(result.summary.verdict).toBe("PASS");
    expect(result.summary.score).toBe(100);
    expect(result.filesScanned).toBe(2);
  });

  it("TC-055: vulnerable project detects all planted vulnerabilities", async () => {
    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(join(FIXTURES, "vulnerable-project"), config);
    const result = runAuditScan(files, config);

    expect(result.findings.length).toBeGreaterThanOrEqual(5);

    const ruleIds = result.findings.map((f) => f.ruleId);
    // exec() detection
    expect(ruleIds.some((id) => id.startsWith("CI-"))).toBe(true);
    // eval() detection
    expect(ruleIds.some((id) => id.startsWith("CE-"))).toBe(true);
    // innerHTML detection
    expect(ruleIds.some((id) => id.startsWith("XSS-"))).toBe(true);
    // Hardcoded secret detection
    expect(ruleIds.some((id) => id.startsWith("HS-"))).toBe(true);
    // SQL injection detection
    expect(ruleIds.some((id) => id.startsWith("SQLI-"))).toBe(true);
  });

  it("TC-056: JSON output is valid and complete", async () => {
    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(join(FIXTURES, "mixed-project"), config);
    const result = runAuditScan(files, config);
    const json = formatJson(result);

    const parsed = JSON.parse(json);
    expect(parsed.findings).toBeDefined();
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.critical).toBeDefined();
    expect(parsed.summary.high).toBeDefined();
    expect(parsed.summary.medium).toBeDefined();
    expect(parsed.summary.low).toBeDefined();
    expect(parsed.summary.info).toBeDefined();
    expect(parsed.summary.score).toBeGreaterThanOrEqual(0);
    expect(parsed.summary.verdict).toBeDefined();
    expect(parsed.filesScanned).toBe(2);
  });

  it("TC-057: SARIF output has correct structure", async () => {
    const config = createDefaultAuditConfig();
    const files = await discoverAuditFiles(join(FIXTURES, "vulnerable-project"), config);
    const result = runAuditScan(files, config);
    const sarif = formatSarif(result);

    const parsed = JSON.parse(sarif);
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.$schema).toContain("sarif");
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].tool.driver.name).toBe("vskill-audit");
    expect(parsed.runs[0].results.length).toBeGreaterThanOrEqual(5);

    // Each result has correct location structure
    for (const r of parsed.runs[0].results) {
      expect(r.ruleId).toBeDefined();
      expect(r.message.text).toBeDefined();
      expect(r.locations[0].physicalLocation.artifactLocation.uri).toBeDefined();
      expect(r.locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
    }
  });

  it("fix suggestions are attached when fix=true", async () => {
    const config = createDefaultAuditConfig();
    config.fix = true;
    const files = await discoverAuditFiles(join(FIXTURES, "vulnerable-project"), config);
    const result = runAuditScan(files, config);
    const withFixes = attachFixSuggestions(result.findings, true);

    // Every finding should have a suggestedFix
    for (const f of withFixes) {
      expect(f.suggestedFix).toBeDefined();
      expect(f.suggestedFix!.length).toBeGreaterThan(0);
    }
  });

  it("config loading works end-to-end", async () => {
    const config = await loadAuditConfig(join(FIXTURES, "clean-project"), {});
    expect(config.maxFiles).toBe(500);
    expect(config.excludePaths).toEqual([]);
  });
});
