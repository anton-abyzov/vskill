import { describe, it, expect } from "vitest";
import { runAuditScan } from "./audit-scanner.js";
import { createDefaultAuditConfig, type AuditFile } from "./audit-types.js";

function makeFile(path: string, content: string): AuditFile {
  return { path, content, sizeBytes: Buffer.byteLength(content) };
}

describe("audit-scanner", () => {
  it("TC-017: returns empty findings for clean files", () => {
    const files: AuditFile[] = [
      makeFile("src/clean.ts", "const x = 1;\nconst y = 2;\nexport { x, y };"),
      makeFile("src/utils.ts", "export function add(a: number, b: number) { return a + b; }"),
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    expect(result.findings).toHaveLength(0);
    expect(result.summary.verdict).toBe("PASS");
    expect(result.summary.total).toBe(0);
    expect(result.summary.score).toBe(100);
  });

  it("TC-018: detects findings across multiple files", () => {
    const files: AuditFile[] = [
      makeFile("src/cmd.ts", 'exec("rm -rf /");'),
      makeFile("src/xss.ts", 'element.innerHTML = userInput;'),
      makeFile("src/sql.ts", '`SELECT * FROM users WHERE id = ${userId}`'),
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    const filePaths = new Set(result.findings.map((f) => f.filePath));
    expect(filePaths.has("src/cmd.ts")).toBe(true);
    expect(filePaths.has("src/xss.ts")).toBe(true);
    expect(filePaths.has("src/sql.ts")).toBe(true);
  });

  it("TC-019: findings are sorted by severity then file path", () => {
    const files: AuditFile[] = [
      makeFile("z-file.ts", "element.innerHTML = x;"), // high
      makeFile("a-file.ts", 'eval("code");'), // critical
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    // Critical should come before high
    const severities = result.findings.map((f) => f.severity);
    const criticalIndex = severities.indexOf("critical");
    const highIndex = severities.indexOf("high");
    if (criticalIndex !== -1 && highIndex !== -1) {
      expect(criticalIndex).toBeLessThan(highIndex);
    }
  });

  it("TC-020: summary statistics are accurate", () => {
    const files: AuditFile[] = [
      makeFile("src/a.ts", 'eval("x");'), // critical (CE-001)
      makeFile("src/b.ts", "element.innerHTML = y;"), // high (XSS-001)
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    expect(result.summary.total).toBe(result.findings.length);
    expect(result.summary.critical + result.summary.high + result.summary.medium +
      result.summary.low + result.summary.info).toBe(result.summary.total);
  });

  it("TC-021: score and verdict are calculated correctly", () => {
    // Clean project -> score 100, PASS
    const cleanFiles: AuditFile[] = [
      makeFile("src/clean.ts", "const x = 1;"),
    ];
    const config = createDefaultAuditConfig();
    const cleanResult = runAuditScan(cleanFiles, config);
    expect(cleanResult.summary.score).toBe(100);
    expect(cleanResult.summary.verdict).toBe("PASS");

    // Many critical findings -> score < 50, FAIL
    const badFiles: AuditFile[] = [
      makeFile("src/bad.ts", [
        'eval("a");',
        'eval("b");',
        'eval("c");',
        'eval("d");',
        'eval("e");',
      ].join("\n")),
    ];
    const badResult = runAuditScan(badFiles, config);
    expect(badResult.summary.score).toBeLessThan(50);
    expect(badResult.summary.verdict).toBe("FAIL");
  });

  it("TC-022: duration is tracked", () => {
    const files: AuditFile[] = [makeFile("src/a.ts", "const x = 1;")];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });

  it("populates filesScanned and filesWithFindings", () => {
    const files: AuditFile[] = [
      makeFile("src/clean.ts", "const x = 1;"),
      makeFile("src/bad.ts", 'eval("x");'),
      makeFile("src/also-clean.ts", "const y = 2;"),
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    expect(result.filesScanned).toBe(3);
    expect(result.filesWithFindings).toBe(1);
  });

  it("applies safeContexts to suppress false positives", () => {
    // innerHTML in a line with DOMPurify should be suppressed
    const files: AuditFile[] = [
      makeFile("src/safe.ts", "element.innerHTML = DOMPurify.sanitize(input);"),
    ];
    const config = createDefaultAuditConfig();
    const result = runAuditScan(files, config);

    const xssFindings = result.findings.filter((f) => f.ruleId === "XSS-001");
    expect(xssFindings).toHaveLength(0);
  });
});
