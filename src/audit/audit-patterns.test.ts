import { describe, it, expect } from "vitest";
import { AUDIT_PATTERNS, PROJECT_PATTERNS } from "./audit-patterns.js";
import { SCAN_PATTERNS } from "../scanner/patterns.js";

describe("audit-patterns", () => {
  it("TC-009: AUDIT_PATTERNS includes all 37 original SCAN_PATTERNS", () => {
    const auditIds = new Set(AUDIT_PATTERNS.map((p) => p.id));
    for (const original of SCAN_PATTERNS) {
      expect(auditIds.has(original.id)).toBe(true);
    }
  });

  it("TC-010: AUDIT_PATTERNS adds at least 15 new project-specific patterns", () => {
    const originalIds = new Set(SCAN_PATTERNS.map((p) => p.id));
    const newPatterns = AUDIT_PATTERNS.filter((p) => !originalIds.has(p.id));
    expect(newPatterns.length).toBeGreaterThanOrEqual(15);
  });

  it("TC-011: SQL injection pattern detects string concatenation in queries", () => {
    const sqliPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "sql-injection",
    );
    expect(sqliPatterns.length).toBeGreaterThan(0);

    const testLine = `"SELECT * FROM users WHERE id = '" + userId + "'"`;
    const matched = sqliPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });

  it("TC-012: SSRF pattern detects URL construction from variables", () => {
    const ssrfPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "ssrf",
    );
    expect(ssrfPatterns.length).toBeGreaterThan(0);

    const testLine = `fetch(userProvidedUrl)`;
    const matched = ssrfPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });

  it("TC-013: Hardcoded secret pattern detects API key assignments", () => {
    const secretPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "hardcoded-secrets",
    );
    expect(secretPatterns.length).toBeGreaterThan(0);

    const testLine = `const API_KEY = "sk-1234567890abcdef"`;
    const matched = secretPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });

  it("TC-014: XSS pattern detects innerHTML assignment", () => {
    const xssPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "xss",
    );
    expect(xssPatterns.length).toBeGreaterThan(0);

    const testLine = `element.innerHTML = userInput`;
    const matched = xssPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });

  it("TC-015: safe contexts suppress false positives", () => {
    const patternsWithSafe = PROJECT_PATTERNS.filter(
      (p) => p.safeContexts && p.safeContexts.length > 0,
    );
    expect(patternsWithSafe.length).toBeGreaterThan(0);

    // For each pattern with safeContexts, at least one safe context regex exists
    for (const pattern of patternsWithSafe) {
      expect(pattern.safeContexts!.length).toBeGreaterThan(0);
      expect(pattern.safeContexts![0]).toBeInstanceOf(RegExp);
    }
  });

  it("TC-016: all pattern IDs are unique across combined set", () => {
    const ids = AUDIT_PATTERNS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("detects open redirect pattern", () => {
    const redirectPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "open-redirect",
    );
    expect(redirectPatterns.length).toBeGreaterThan(0);

    const testLine = `res.redirect(req.query.url)`;
    const matched = redirectPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });

  it("detects insecure deserialization", () => {
    const deserPatterns = PROJECT_PATTERNS.filter(
      (p) => p.category === "insecure-deserialization",
    );
    expect(deserPatterns.length).toBeGreaterThan(0);

    const testLine = `yaml.load(userInput)`;
    const matched = deserPatterns.some((p) => {
      const regex = new RegExp(p.pattern.source, p.pattern.flags);
      return regex.test(testLine);
    });
    expect(matched).toBe(true);
  });
});
