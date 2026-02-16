// ---------------------------------------------------------------------------
// Tier 1 Security Scan Patterns
// 37 regex-based patterns for static analysis of skill content.
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export type PatternSeverity = "critical" | "high" | "medium" | "low" | "info";

export type PatternCategory =
  | "command-injection"
  | "data-exfiltration"
  | "privilege-escalation"
  | "credential-theft"
  | "prompt-injection"
  | "filesystem-access"
  | "network-access"
  | "code-execution";

export type ScanVerdict = "PASS" | "CONCERNS" | "FAIL";

export interface ScanPattern {
  id: string;
  name: string;
  severity: PatternSeverity;
  description: string;
  pattern: RegExp;
  category: PatternCategory;
}

export interface ScanFinding {
  patternId: string;
  patternName: string;
  severity: PatternSeverity;
  category: PatternCategory;
  match: string;
  lineNumber: number;
  context: string;
}

// ---- Patterns (37 total) --------------------------------------------------

export const SCAN_PATTERNS: ScanPattern[] = [
  // --- Command Injection (1-7) ---------------------------------------------
  {
    id: "CI-001",
    name: "exec() call",
    severity: "critical",
    description: "Detects child_process.exec or similar exec calls that run shell commands",
    pattern: /\bexec\s*\(/g,
    category: "command-injection",
  },
  {
    id: "CI-002",
    name: "spawn() call",
    severity: "high",
    description: "Detects child_process.spawn invocations",
    pattern: /\bspawn\s*\(/g,
    category: "command-injection",
  },
  {
    id: "CI-003",
    name: "system() call",
    severity: "critical",
    description: "Detects system-level command execution",
    pattern: /\bsystem\s*\(/g,
    category: "command-injection",
  },
  {
    id: "CI-004",
    name: "Shell command strings",
    severity: "high",
    description: "Detects common shell commands embedded in strings",
    pattern: /(?:"|'|`)\s*(?:\/bin\/(?:sh|bash|zsh)|cmd(?:\.exe)?)\b/g,
    category: "command-injection",
  },
  {
    id: "CI-005",
    name: "Backtick shell execution",
    severity: "high",
    description: "Detects backtick-based command substitution patterns",
    pattern: /child_process|execSync|spawnSync|execFile/g,
    category: "command-injection",
  },
  {
    id: "CI-006",
    name: "Shell pipe operator",
    severity: "medium",
    description: "Detects shell piping within exec-like calls",
    pattern: /exec\s*\([^)]*\|[^)]*\)/g,
    category: "command-injection",
  },
  {
    id: "CI-007",
    name: "Command interpolation",
    severity: "high",
    description: "Detects string interpolation in shell commands",
    pattern: /exec\s*\(\s*`[^`]*\$\{/g,
    category: "command-injection",
  },

  // --- Data Exfiltration (8-12) --------------------------------------------
  {
    id: "DE-001",
    name: "Fetch to external URL",
    severity: "high",
    description: "Detects fetch calls to external/dynamic URLs",
    pattern: /fetch\s*\(\s*(?:`[^`]*\$\{|[a-zA-Z_]\w*\s*[\+,])/g,
    category: "data-exfiltration",
  },
  {
    id: "DE-002",
    name: "XMLHttpRequest usage",
    severity: "high",
    description: "Detects XMLHttpRequest which can send data externally",
    pattern: /new\s+XMLHttpRequest/g,
    category: "data-exfiltration",
  },
  {
    id: "DE-003",
    name: "WebSocket to external host",
    severity: "high",
    description: "Detects WebSocket connections that could exfiltrate data",
    pattern: /new\s+WebSocket\s*\(/g,
    category: "data-exfiltration",
  },
  {
    id: "DE-004",
    name: "DNS exfiltration pattern",
    severity: "medium",
    description: "Detects encoding data into DNS lookups",
    pattern: /dns\.(?:resolve|lookup)\s*\(.*(?:\+|concat|\$\{)/g,
    category: "data-exfiltration",
  },
  {
    id: "DE-005",
    name: "Base64 encode and send",
    severity: "medium",
    description: "Detects base64 encoding followed by network send (exfil pattern)",
    pattern: /btoa\s*\(|Buffer\.from\([^)]*\)\.toString\s*\(\s*['"]base64['"]/g,
    category: "data-exfiltration",
  },

  // --- Privilege Escalation (13-17) ----------------------------------------
  {
    id: "PE-001",
    name: "sudo invocation",
    severity: "critical",
    description: "Detects attempts to run commands with sudo",
    pattern: /\bsudo\s+/g,
    category: "privilege-escalation",
  },
  {
    id: "PE-002",
    name: "chmod modification",
    severity: "high",
    description: "Detects changing file permissions",
    pattern: /\bchmod\s+/g,
    category: "privilege-escalation",
  },
  {
    id: "PE-003",
    name: "chown modification",
    severity: "high",
    description: "Detects changing file ownership",
    pattern: /\bchown\s+/g,
    category: "privilege-escalation",
  },
  {
    id: "PE-004",
    name: "setuid/setgid",
    severity: "critical",
    description: "Detects setuid/setgid operations",
    pattern: /\bset(?:uid|gid|euid|egid)\s*\(/g,
    category: "privilege-escalation",
  },
  {
    id: "PE-005",
    name: "Process privilege change",
    severity: "high",
    description: "Detects process.setuid or similar privilege modifications",
    pattern: /process\.set(?:uid|gid|groups)\s*\(/g,
    category: "privilege-escalation",
  },

  // --- Credential Theft (18-23) --------------------------------------------
  {
    id: "CT-001",
    name: "Read .env file",
    severity: "critical",
    description: "Detects reading .env files which contain secrets",
    pattern: /readFile(?:Sync)?\s*\([^)]*\.env\b/g,
    category: "credential-theft",
  },
  {
    id: "CT-002",
    name: "Read SSH keys",
    severity: "critical",
    description: "Detects accessing .ssh directory or key files",
    pattern: /\.ssh[/\\]|id_rsa|id_ed25519|authorized_keys/g,
    category: "credential-theft",
  },
  {
    id: "CT-003",
    name: "Read AWS credentials",
    severity: "critical",
    description: "Detects accessing AWS credential files",
    pattern: /\.aws[/\\]credentials|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID/g,
    category: "credential-theft",
  },
  {
    id: "CT-004",
    name: "Keychain access",
    severity: "critical",
    description: "Detects macOS keychain or system credential store access",
    pattern: /security\s+find-(?:generic|internet)-password|keychain|credential-store/g,
    category: "credential-theft",
  },
  {
    id: "CT-005",
    name: "Secrets in environment",
    severity: "high",
    description: "Detects broad process.env access patterns",
    pattern: /process\.env\[(?:[^'"\]]*\+|[a-zA-Z_]\w*\])/g,
    category: "credential-theft",
  },
  {
    id: "CT-006",
    name: "Token/secret variable patterns",
    severity: "medium",
    description: "Detects variables likely holding secrets being sent externally",
    pattern: /(?:token|secret|password|api_key|apiKey)\s*[:=]\s*(?:process\.env|readFile)/gi,
    category: "credential-theft",
  },

  // --- Prompt Injection (24-27) --------------------------------------------
  {
    id: "PI-001",
    name: "System prompt override",
    severity: "critical",
    description: "Detects attempts to override or replace system prompts",
    pattern: /(?:system\s*prompt|system\s*message|system\s*instruction)\s*[:=]/gi,
    category: "prompt-injection",
  },
  {
    id: "PI-002",
    name: "Ignore previous instructions",
    severity: "critical",
    description: "Detects classic prompt injection phrase",
    pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
    category: "prompt-injection",
  },
  {
    id: "PI-003",
    name: "Role impersonation",
    severity: "high",
    description: "Detects attempts to assume a different AI role",
    pattern: /you\s+are\s+now\s+(?:a|an)\s+|act\s+as\s+(?:a|an)\s+|pretend\s+(?:to\s+be|you\s+are)/gi,
    category: "prompt-injection",
  },
  {
    id: "PI-004",
    name: "Instruction boundary escape",
    severity: "high",
    description: "Detects delimiter injection patterns",
    pattern: /\[\/INST\]|\[INST\]|<\|im_end\|>|<\|im_start\|>|<\|system\|>/g,
    category: "prompt-injection",
  },

  // --- Filesystem Access (28-31) -------------------------------------------
  {
    id: "FS-001",
    name: "Recursive delete",
    severity: "critical",
    description: "Detects rm -rf or recursive deletion commands",
    pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*r|rimraf\s*\(/g,
    category: "filesystem-access",
  },
  {
    id: "FS-002",
    name: "Write to system paths",
    severity: "critical",
    description: "Detects writing to system-critical paths",
    pattern: /writeFile(?:Sync)?\s*\([^)]*(?:\/etc\/|\/usr\/|\/var\/|\/System\/|C:\\Windows)/g,
    category: "filesystem-access",
  },
  {
    id: "FS-003",
    name: "Path traversal",
    severity: "high",
    description: "Detects directory traversal attempts",
    pattern: /\.\.[/\\]\.\.[/\\]|\.\.(?:[/\\]){2,}/g,
    category: "filesystem-access",
  },
  {
    id: "FS-004",
    name: "Symlink manipulation",
    severity: "medium",
    description: "Detects symlink creation that could be used for path hijacking",
    pattern: /symlink(?:Sync)?\s*\(|ln\s+-s\s+/g,
    category: "filesystem-access",
  },

  // --- Network Access (32-34) ----------------------------------------------
  {
    id: "NA-001",
    name: "Curl/wget to unknown host",
    severity: "high",
    description: "Detects curl or wget commands that download from external hosts",
    pattern: /\b(?:curl|wget)\s+(?:-[a-zA-Z]*\s+)*(?:https?:\/\/|[`"'])/g,
    category: "network-access",
  },
  {
    id: "NA-002",
    name: "Reverse shell pattern",
    severity: "critical",
    description: "Detects reverse shell connection patterns",
    pattern: /(?:\/dev\/tcp\/|nc\s+-[a-z]*e|ncat\s|bash\s+-i\s+>&|mkfifo|0<&\d+)/g,
    category: "network-access",
  },
  {
    id: "NA-003",
    name: "Dynamic URL construction",
    severity: "medium",
    description: "Detects building URLs from variables (potential C2 communication)",
    pattern: /(?:http|https):\/\/\$\{|(?:http|https):\/\/['"]\s*\+/g,
    category: "network-access",
  },

  // --- Code Execution (35-37) ----------------------------------------------
  {
    id: "CE-001",
    name: "eval() usage",
    severity: "critical",
    description: "Detects eval() which executes arbitrary code",
    pattern: /\beval\s*\(/g,
    category: "code-execution",
  },
  {
    id: "CE-002",
    name: "Function() constructor",
    severity: "critical",
    description: "Detects new Function() which compiles and runs arbitrary code",
    pattern: /new\s+Function\s*\(/g,
    category: "code-execution",
  },
  {
    id: "CE-003",
    name: "Dynamic remote import",
    severity: "high",
    description: "Detects dynamic import of remote/variable modules",
    pattern: /import\s*\(\s*(?:`[^`]*\$\{|[a-zA-Z_]\w*\s*[\+)])/g,
    category: "code-execution",
  },
];

// ---- Scanner function -----------------------------------------------------

/**
 * Scan content against all 37 patterns, returning every match found.
 */
export function scanContent(content: string): ScanFinding[] {
  const lines = content.split("\n");
  const findings: ScanFinding[] = [];

  for (const pattern of SCAN_PATTERNS) {
    // Reset the regex lastIndex for each pattern (they use /g flag)
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        // Build context: up to 1 line before and after
        const contextLines: string[] = [];
        if (lineIdx > 0) contextLines.push(lines[lineIdx - 1]);
        contextLines.push(line);
        if (lineIdx < lines.length - 1) contextLines.push(lines[lineIdx + 1]);

        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          match: match[0],
          lineNumber: lineIdx + 1,
          context: contextLines.join("\n"),
        });
      }
    }
  }

  return findings;
}
