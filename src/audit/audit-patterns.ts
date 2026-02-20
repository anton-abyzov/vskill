/**
 * Extended audit patterns for project-level security scanning.
 *
 * Imports the existing 37 SCAN_PATTERNS from the scanner module
 * and extends them with project-audit-specific patterns for
 * SQL injection, SSRF, XSS, hardcoded secrets, etc.
 */

import { SCAN_PATTERNS, type ScanPattern } from "../scanner/patterns.js";
import type { PatternCheck } from "../scanner/types.js";

/**
 * Extended pattern with safe-context awareness and confidence.
 */
export interface AuditPatternCheck extends PatternCheck {
  /** Pattern ID (unique across all patterns) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Regexes that suppress the finding when they match the line */
  safeContexts?: RegExp[];
  /** Default confidence for this pattern */
  confidence: "high" | "medium" | "low";
}

/**
 * Project-specific security patterns (beyond the existing 37 skill patterns).
 */
export const PROJECT_PATTERNS: AuditPatternCheck[] = [
  // --- SQL Injection ---
  {
    id: "SQLI-001",
    name: "SQL string concatenation",
    severity: "critical",
    category: "sql-injection",
    message: "SQL query built with string concatenation — use parameterized queries",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\s+.*(?:\+\s*\w|\$\{)/gi,
    confidence: "high",
    safeContexts: [/\/\/.*SQL/i, /\*.*SQL/i],
  },
  {
    id: "SQLI-002",
    name: "Raw SQL template literal",
    severity: "high",
    category: "sql-injection",
    message: "SQL query in template literal with interpolation",
    pattern: /`\s*(?:SELECT|INSERT|UPDATE|DELETE)\s+[^`]*\$\{/gi,
    confidence: "high",
  },
  {
    id: "SQLI-003",
    name: "Unparameterized query method",
    severity: "high",
    category: "sql-injection",
    message: "Database query with string interpolation instead of parameters",
    pattern: /\.(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/gi,
    confidence: "medium",
  },

  // --- SSRF ---
  {
    id: "SSRF-001",
    name: "Fetch with variable URL",
    severity: "high",
    category: "ssrf",
    message: "HTTP request with user-controlled URL — validate against allowlist",
    pattern: /(?:fetch|axios\.get|axios\.post|got|request|http\.get|https\.get)\s*\(\s*(?:[a-zA-Z_]\w*(?:\.\w+)*)\s*[,)]/g,
    confidence: "medium",
    safeContexts: [/const\s+\w+\s*=\s*['"]https?:\/\//, /\.env\./],
  },
  {
    id: "SSRF-002",
    name: "URL from request parameters",
    severity: "critical",
    category: "ssrf",
    message: "URL constructed from request input — potential SSRF",
    pattern: /(?:req\.(?:query|params|body)\.\w+|request\.(?:query|params|body)\.\w+).*(?:fetch|axios|got|request|http|https)/g,
    confidence: "high",
  },

  // --- Broken Access Control ---
  {
    id: "BAC-001",
    name: "Missing auth middleware",
    severity: "medium",
    category: "broken-access-control",
    message: "Route handler without visible authentication middleware",
    pattern: /(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*['"][^'"]*['"]\s*,\s*(?:async\s+)?\(?(?:req|ctx)/g,
    confidence: "low",
    safeContexts: [/auth/, /protect/, /guard/, /middleware/, /public/, /health/],
  },
  {
    id: "BAC-002",
    name: "Direct ID access without ownership check",
    severity: "medium",
    category: "broken-access-control",
    message: "Resource accessed by ID from request without ownership verification",
    pattern: /(?:findById|findOne|findUnique)\s*\(\s*(?:req\.(?:params|query|body)\.\w+|ctx\.params\.\w+)/g,
    confidence: "low",
    safeContexts: [/userId/, /session\.user/, /currentUser/],
  },

  // --- Hardcoded Secrets ---
  {
    id: "HS-001",
    name: "API key assignment",
    severity: "critical",
    category: "hardcoded-secrets",
    message: "Hardcoded API key or secret in source code",
    pattern: /(?:api[_-]?key|apiKey|secret[_-]?key|secretKey|access[_-]?token|accessToken)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
    confidence: "high",
    safeContexts: [/process\.env/, /\.env/, /example/, /placeholder/, /test/i, /mock/i],
  },
  {
    id: "HS-002",
    name: "Private key in source",
    severity: "critical",
    category: "hardcoded-secrets",
    message: "Private key embedded in source code",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    confidence: "high",
  },
  {
    id: "HS-003",
    name: "Password assignment",
    severity: "high",
    category: "hardcoded-secrets",
    message: "Hardcoded password in source code",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    confidence: "medium",
    safeContexts: [/process\.env/, /\.env/, /hash/, /bcrypt/, /argon/, /test/i, /mock/i, /example/i],
  },
  {
    id: "HS-004",
    name: "AWS/cloud credential pattern",
    severity: "critical",
    category: "hardcoded-secrets",
    message: "Cloud provider credential pattern detected",
    pattern: /(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36})/g,
    confidence: "high",
  },

  // --- XSS ---
  {
    id: "XSS-001",
    name: "innerHTML assignment",
    severity: "high",
    category: "xss",
    message: "Direct innerHTML assignment — use textContent or sanitize input",
    pattern: /\.innerHTML\s*=\s*/g,
    confidence: "high",
    safeContexts: [/sanitize/, /DOMPurify/, /escape/],
  },
  {
    id: "XSS-002",
    name: "dangerouslySetInnerHTML",
    severity: "high",
    category: "xss",
    message: "React dangerouslySetInnerHTML — ensure content is sanitized",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{/g,
    confidence: "high",
    safeContexts: [/sanitize/, /DOMPurify/],
  },
  {
    id: "XSS-003",
    name: "document.write",
    severity: "high",
    category: "xss",
    message: "document.write with dynamic content — potential XSS",
    pattern: /document\.write(?:ln)?\s*\(/g,
    confidence: "medium",
  },

  // --- Open Redirect ---
  {
    id: "OR-001",
    name: "Redirect from user input",
    severity: "medium",
    category: "open-redirect",
    message: "Redirect URL from user input — validate against allowlist",
    pattern: /(?:res\.redirect|redirect|location\.href|window\.location)\s*(?:\(|\s*=)\s*(?:req\.(?:query|params|body)\.\w+)/g,
    confidence: "high",
  },
  {
    id: "OR-002",
    name: "Location header from variable",
    severity: "medium",
    category: "open-redirect",
    message: "Location header set from variable — potential open redirect",
    pattern: /(?:setHeader|set)\s*\(\s*['"]Location['"]\s*,\s*(?:[a-zA-Z_]\w*)/gi,
    confidence: "low",
    safeContexts: [/allowlist/, /whitelist/, /valid/],
  },

  // --- Insecure Deserialization ---
  {
    id: "ID-001",
    name: "YAML unsafe load",
    severity: "high",
    category: "insecure-deserialization",
    message: "yaml.load without safe loader — use yaml.safeLoad or yaml.load with safe schema",
    pattern: /yaml\.load\s*\(/g,
    confidence: "medium",
    safeContexts: [/safe/, /safeLoad/, /SAFE_SCHEMA/],
  },
  {
    id: "ID-002",
    name: "Pickle deserialization",
    severity: "critical",
    category: "insecure-deserialization",
    message: "pickle.loads on untrusted data — use safe alternatives",
    pattern: /pickle\.loads?\s*\(/g,
    confidence: "high",
  },
  {
    id: "ID-003",
    name: "Unsafe JSON parse of request body",
    severity: "low",
    category: "insecure-deserialization",
    message: "JSON.parse of raw request body — ensure schema validation",
    pattern: /JSON\.parse\s*\(\s*(?:req\.body|request\.body|body)\s*\)/g,
    confidence: "low",
    safeContexts: [/zod/, /joi/, /yup/, /ajv/, /validate/],
  },

  // --- Weak Cryptography ---
  {
    id: "WC-001",
    name: "MD5 usage",
    severity: "medium",
    category: "weak-cryptography",
    message: "MD5 is cryptographically broken — use SHA-256 or better",
    pattern: /(?:createHash|crypto\.subtle\.digest)\s*\(\s*['"]md5['"]/gi,
    confidence: "high",
  },
  {
    id: "WC-002",
    name: "SHA-1 usage",
    severity: "medium",
    category: "weak-cryptography",
    message: "SHA-1 is deprecated — use SHA-256 or better",
    pattern: /(?:createHash|crypto\.subtle\.digest)\s*\(\s*['"]sha-?1['"]/gi,
    confidence: "high",
  },
];

/**
 * Combined audit patterns: original SCAN_PATTERNS + project-specific patterns.
 *
 * The SCAN_PATTERNS are adapted to AuditPatternCheck interface (id from ScanPattern.id).
 */
export const AUDIT_PATTERNS: AuditPatternCheck[] = [
  ...SCAN_PATTERNS.map((sp) => ({
    id: sp.id,
    name: sp.name,
    severity: sp.severity as AuditPatternCheck["severity"],
    category: sp.category,
    message: sp.description,
    pattern: sp.pattern,
    confidence: "high" as const,
  })),
  ...PROJECT_PATTERNS,
];
