/**
 * Fix suggestions for audit findings.
 *
 * Maps pattern IDs to human-readable remediation advice.
 */

import type { AuditFinding } from "./audit-types.js";

/** Fix suggestion lookup by pattern ID */
export const FIX_SUGGESTIONS: Record<string, string> = {
  // --- Original SCAN_PATTERNS (37) ---
  "CI-001": "Replace exec() with execFile() or spawn() with explicit argument arrays to prevent command injection",
  "CI-002": "Ensure spawn() arguments are not user-controlled; use argument arrays instead of shell strings",
  "CI-003": "Replace system() with safer subprocess APIs that don't invoke a shell",
  "CI-004": "Avoid embedding shell paths in strings; use Node.js APIs or explicit command arrays",
  "CI-005": "Use execFile/spawn instead of execSync/spawnSync when possible; never pass unsanitized input",
  "CI-006": "Avoid shell pipe operators in exec calls; use separate process pipelines",
  "CI-007": "Never interpolate user input into exec() template strings; use execFile with argument arrays",
  "CI-008": "Never pipe curl/wget output directly to a shell; download to a file first, verify its integrity, then execute",
  "DE-001": "Validate and allowlist URLs before making fetch requests; avoid dynamic URL construction",
  "DE-002": "Replace XMLHttpRequest with fetch() and apply URL allowlisting",
  "DE-003": "Validate WebSocket connection URLs against an allowlist",
  "DE-004": "Avoid encoding data into DNS lookups; review data flow for exfiltration",
  "DE-005": "Review base64 encoding patterns for data exfiltration; ensure data isn't being sent externally",
  "PE-001": "Remove sudo invocations; run the required commands with appropriate user permissions",
  "PE-002": "Avoid chmod in application code; set permissions during deployment instead",
  "PE-003": "Avoid chown in application code; configure ownership during deployment",
  "PE-004": "Never use setuid/setgid in application code; run with least privilege",
  "PE-005": "Remove process.setuid/setgid calls; use proper OS-level privilege management",
  "CT-001": "Use environment variables or a secrets manager instead of reading .env files at runtime",
  "CT-002": "Never access SSH keys from application code; use a key management service",
  "CT-003": "Use IAM roles or a secrets manager instead of directly accessing AWS credential files",
  "CT-004": "Never access the system keychain from application code; use a proper secrets API",
  "CT-005": "Access environment variables by specific name, not dynamically; use a config loader",
  "CT-006": "Never hardcode secrets; use environment variables or a secrets manager",
  "PI-001": "Never allow user input to override system prompts; use input validation and sandboxing",
  "PI-002": "Filter and validate all input before passing to AI models; implement prompt guardrails",
  "PI-003": "Validate AI model inputs to prevent role impersonation attacks",
  "PI-004": "Sanitize input to remove instruction boundary markers; use structured prompting",
  "FS-001": "Avoid recursive delete operations; use targeted file removal with path validation",
  "FS-002": "Never write to system paths from application code; use application-specific directories",
  "FS-003": "Validate and normalize file paths; reject paths containing '..'",
  "FS-004": "Validate symlink targets before creation; use realpath() to resolve paths",
  "NA-001": "Validate and allowlist URLs for curl/wget; use application-level HTTP clients instead",
  "NA-002": "Remove reverse shell patterns; this is a critical security vulnerability",
  "NA-003": "Avoid constructing URLs from variables; use allowlisted base URLs with parameterized paths",
  "CE-001": "Replace eval() with JSON.parse() for data or Function constructor for code; never eval user input",
  "CE-002": "Avoid new Function(); use explicit function definitions instead",
  "CE-003": "Avoid dynamic imports with user-controlled paths; use a module allowlist",

  // --- Project-specific AUDIT_PATTERNS ---
  "SQLI-001": "Use parameterized queries or prepared statements instead of string concatenation in SQL",
  "SQLI-002": "Use parameterized queries; never use template literals for SQL with user input",
  "SQLI-003": "Use query parameters (?) or named parameters (:name) instead of string interpolation",
  "SSRF-001": "Validate URLs against an allowlist of trusted domains before making requests",
  "SSRF-002": "Never pass request parameters directly to HTTP clients; validate and sanitize URLs",
  "BAC-001": "Add authentication middleware to all non-public route handlers",
  "BAC-002": "Verify resource ownership by comparing request user ID with resource owner ID",
  "HS-001": "Move API keys to environment variables or a secrets manager; never hardcode in source",
  "HS-002": "Remove private keys from source code; use a key management service or environment variables",
  "HS-003": "Move passwords to environment variables or a secrets manager; use bcrypt/argon2 for hashing",
  "HS-004": "Remove cloud credentials from source code; use IAM roles or environment-based configuration",
  "XSS-001": "Use textContent instead of innerHTML; if HTML is needed, sanitize with DOMPurify",
  "XSS-002": "Ensure content passed to dangerouslySetInnerHTML is sanitized with DOMPurify or similar",
  "XSS-003": "Replace document.write() with DOM manipulation methods (createElement, appendChild)",
  "OR-001": "Validate redirect URLs against an allowlist of trusted paths/domains",
  "OR-002": "Only set Location header from a predefined list of valid redirect targets",
  "ID-001": "Use yaml.safeLoad() or yaml.load() with SAFE_SCHEMA instead of yaml.load()",
  "ID-002": "Replace pickle with JSON or another safe serialization format; never deserialize untrusted data",
  "ID-003": "Validate parsed JSON against a schema (Zod, Joi, or ajv) before using it",
  "WC-001": "Replace MD5 with SHA-256 or SHA-3 for cryptographic hashing",
  "WC-002": "Replace SHA-1 with SHA-256 or SHA-3; SHA-1 is deprecated for security use",
};

/**
 * Attach fix suggestions to findings based on their ruleId.
 * Only attaches when fix=true.
 */
export function attachFixSuggestions(
  findings: AuditFinding[],
  fix: boolean,
): AuditFinding[] {
  if (!fix) return findings;

  return findings.map((f) => {
    const suggestion = FIX_SUGGESTIONS[f.ruleId];
    if (suggestion) {
      return { ...f, suggestedFix: suggestion };
    }
    return f;
  });
}
