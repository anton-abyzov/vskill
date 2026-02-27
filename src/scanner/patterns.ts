// ---------------------------------------------------------------------------
// Tier 1 Security Scan Patterns
// 38 regex-based patterns for static analysis of skill content.
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
  | "code-execution"
  | "dci-abuse";

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

// ---- Patterns (52 total) --------------------------------------------------

export const SCAN_PATTERNS: ScanPattern[] = [
  // --- Command Injection (1-7) ---------------------------------------------
  {
    id: "CI-001",
    name: "exec() call",
    severity: "critical",
    description: "Detects child_process.exec or similar exec calls that run shell commands",
    pattern: /(?<!\.)\bexec\s*\(/g,
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
    pattern: /\bsystem\(/g,
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
    pattern: /require\s*\(\s*['"`]child_process['"`]\)|from\s+['"`]child_process['"`]|\b(?:execSync|spawnSync|execFile)\s*\(/g,
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
  {
    id: "CI-008",
    name: "Pipe-to-shell execution",
    severity: "critical",
    description: "Detects curl/wget output piped directly to a shell interpreter (download-and-execute)",
    pattern: /\b(?:curl|wget)\b[^|]*\|\s*(?:(?:\/\w+)*\/)?(?:env\s+)?(?:ba|z|da|k)?sh\b/g,
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
    severity: "medium",
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
    severity: "high",
    description: "Detects rm -rf or recursive deletion commands",
    pattern: /rm\s+-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|rm\s+(?:-r|--recursive)\s+(?:-f|--force)|rm\s+(?:-f|--force)\s+(?:-r|--recursive)|rimraf\s*\(/g,
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
    severity: "low",
    description: "Detects curl or wget commands that download from external hosts",
    pattern: /\b(?:curl|wget)\s+(?:-[\w=-]+\s+)*(?:https?:\/\/|[`"'])/g,
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
    pattern: /(?<!\.)eval\s*\(/g,
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

  // --- DCI Block Abuse (38-51) -----------------------------------------------
  // DCI blocks are shell commands in SKILL.md executed via ! prefix.
  // These patterns detect malicious use within DCI contexts.
  {
    id: "DCI-001",
    name: "DCI credential file read",
    severity: "critical",
    description: "DCI block reads credential files (~/.ssh/, ~/.aws/, .env)",
    pattern: /^\s*!\s*`[^`]*(?:~\/\.ssh\/|~\/\.aws\/|\.env\b|\.gnupg\/)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-002",
    name: "DCI network exfiltration",
    severity: "critical",
    description: "DCI block uses curl/wget for network access",
    pattern: /^\s*!\s*`[^`]*\b(?:curl|wget)\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-003",
    name: "DCI fetch/nc network call",
    severity: "critical",
    description: "DCI block uses fetch or netcat for network access",
    pattern: /^\s*!\s*`[^`]*\b(?:fetch|nc|ncat|netcat)\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-004",
    name: "DCI agent config write",
    severity: "critical",
    description: "DCI block writes to agent config files (CLAUDE.md, AGENTS.md, .claude/)",
    pattern: /^\s*!\s*`[^`]*(?:>\s*.*(?:CLAUDE\.md|AGENTS\.md|\.claude\/|\.specweave\/))/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-005",
    name: "DCI agent config modify",
    severity: "critical",
    description: "DCI block modifies agent config via tee/sed/echo append",
    pattern: /^\s*!\s*`[^`]*(?:tee|sed\s+-i|echo\s+.*>>)\s*.*(?:CLAUDE\.md|AGENTS\.md|\.claude\/)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-006",
    name: "DCI base64 decode",
    severity: "critical",
    description: "DCI block contains base64 decoding (obfuscation)",
    pattern: /^\s*!\s*`[^`]*\b(?:base64\s+(?:-[dD]|--decode)|atob\s*\()/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-007",
    name: "DCI hex escape obfuscation",
    severity: "critical",
    description: "DCI block contains hex escape sequences (obfuscation)",
    pattern: /^\s*!\s*`[^`]*\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){3,}/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-008",
    name: "DCI eval execution",
    severity: "critical",
    description: "DCI block uses eval for code execution",
    pattern: /^\s*!\s*`[^`]*\beval\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-009",
    name: "DCI download and execute",
    severity: "critical",
    description: "DCI block pipes downloaded content to shell (download-and-execute)",
    pattern: /^\s*!\s*`[^`]*\b(?:curl|wget)\b[^`]*\|\s*(?:ba|z|da|k)?sh\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-010",
    name: "DCI reverse shell",
    severity: "critical",
    description: "DCI block establishes a reverse shell connection",
    pattern: /^\s*!\s*`[^`]*(?:\/dev\/tcp\/|bash\s+-i\s+>&|mkfifo|nc\s+-[a-z]*e)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-011",
    name: "DCI sudo escalation",
    severity: "critical",
    description: "DCI block uses sudo for privilege escalation",
    pattern: /^\s*!\s*`[^`]*\bsudo\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-012",
    name: "DCI rm destructive command",
    severity: "critical",
    description: "DCI block executes destructive rm -rf command",
    pattern: /^\s*!\s*`[^`]*\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-013",
    name: "DCI home dir exfiltration",
    severity: "critical",
    description: "DCI block reads from home directory sensitive paths",
    pattern: /^\s*!\s*`[^`]*(?:cat|less|head|tail|strings)\s+[^`]*(?:~\/\.|\/home\/[^`]*\.)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-014",
    name: "DCI data pipe to network",
    severity: "critical",
    description: "DCI block pipes local data to a network command",
    pattern: /^\s*!\s*`[^`]*(?:cat|tar|zip)\s+[^|`]*\|\s*(?:curl|wget|nc)\b/gm,
    category: "dci-abuse",
  },
];

// ---- Safe-context patterns for DCI blocks ----------------------------------
// The canonical skill-memories lookup is a known-safe DCI pattern.
// Suppress DCI-abuse findings when the line matches this pattern AND
// no malicious DCI pattern also matches (prevents appended-command bypass).

const SAFE_DCI_PATTERNS: RegExp[] = [
  /^\s*!\s*`for\s+d\s+in\s+\.specweave\/skill-memories/,
];

/** All malicious DCI patterns extracted for the two-pass safe check */
const MALICIOUS_DCI_PATTERNS: RegExp[] = SCAN_PATTERNS
  .filter((p) => p.category === "dci-abuse")
  .map((p) => new RegExp(p.pattern.source, p.pattern.flags));

/**
 * Returns true if the line matches a known-safe DCI pattern
 * AND no malicious DCI pattern also matches (two-pass check).
 */
function isSafeDciBlock(line: string): boolean {
  const matchesSafe = SAFE_DCI_PATTERNS.some((p) => p.test(line));
  if (!matchesSafe) return false;

  // Two-pass: if ANY malicious DCI pattern also matches, it's NOT safe
  const matchesMalicious = MALICIOUS_DCI_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(line);
  });
  return !matchesMalicious;
}

// ---- FS-001 safe target detection ------------------------------------------
// Downgrade FS-001 (rm -rf) from "high" to "info" when the command only
// targets known build artifact / cache directories.

const SAFE_RM_TARGETS = [
  "build", ".build", "dist", "out", "target", ".next", ".open-next",
  "node_modules", ".gradle", "~/.gradle", "~/.m2", "~/.npm", "~/.cache",
  ".cache", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".tox", ".venv", "venv", "env", ".eggs", "*.egg-info",
  "coverage", ".nyc_output", ".turbo", ".parcel-cache",
  "tmp", ".tmp", "temp",
];
const SAFE_RM_SET = new Set(SAFE_RM_TARGETS);

/**
 * Extract targets from an `rm` command with both -r and -f flags.
 * Handles combined flags (rm -rf), separated flags (rm -r -f),
 * and long flags (rm --recursive --force).
 * Returns null if the line doesn't contain rm with both -r and -f.
 */
function extractRmRfTargets(line: string): string[] | null {
  // Combined flags: rm -rf, rm -fr, rm -rfi, etc.
  let m = line.match(/rm\s+-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*\s+(.*)/);
  if (m) {
    const targets = m[1].trim().split(/\s+/).filter(Boolean);
    return targets.length > 0 ? targets : null;
  }
  // Separated/long flags: rm -r -f, rm --recursive --force, etc.
  m = line.match(/rm\s+((?:--?\w[\w-]*\s+)+)(.*)/);
  if (m) {
    const flags = m[1];
    const hasR = /(?:^|\s)(?:-[a-zA-Z]*r\b|--recursive\b)/.test(flags);
    const hasF = /(?:^|\s)(?:-[a-zA-Z]*f\b|--force\b)/.test(flags);
    if (hasR && hasF) {
      const targets = m[2].trim().split(/\s+/).filter(Boolean);
      return targets.length > 0 ? targets : null;
    }
  }
  return null;
}

/**
 * Check if a line containing `rm -rf` only targets safe build artifact dirs.
 * Returns true when ALL targets after the flags are in the safe set.
 */
function isRmTargetingSafePaths(line: string): boolean {
  const targets = extractRmRfTargets(line);
  if (!targets) return false;

  return targets.every((t) => {
    const clean = t.replace(/^[`'"]+|[`'"]+$/g, "");
    return SAFE_RM_SET.has(clean) || SAFE_RM_SET.has(clean.replace(/^~\//, ""));
  });
}

// ---- FS-001 system-path detection -------------------------------------------
// Escalate FS-001 when targeting system-critical paths or variable expansion.

const SYSTEM_PATH_PREFIXES = ["/etc", "/usr", "/var", "/System", "/bin", "/sbin", "/opt", "/lib", "/home", "/root", "C:\\Windows", "C:\\Program"];
const SYSTEM_PATH_EXACT = new Set(["/", "~", "$HOME", "~/", "*", ".", ".."]);

function isRmTargetingSystemPaths(line: string): boolean {
  const targets = extractRmRfTargets(line);
  if (!targets) return false;

  return targets.some((t) => {
    const clean = t.replace(/^[`'"]+|[`'"]+$/g, "");
    if (SYSTEM_PATH_EXACT.has(clean)) return true;
    if (SYSTEM_PATH_PREFIXES.some((p) => clean.startsWith(p))) return true;
    if (/\.\.[\\/]/.test(clean)) return true;
    if (/\$\{?\w|\$\(|`/.test(clean)) return true;
    return false;
  });
}

// ---- Markdown fenced code block detection ----------------------------------
// Pre-compute which lines are inside fenced code blocks (``` or ~~~).
// Used to downgrade documentation-context patterns (PE-001/PE-002/PE-003/FS-001).

function computeFencedCodeBlockLines(lines: string[]): Set<number> {
  const fenced = new Set<number>();
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      fenced.add(i);
      inBlock = !inBlock;
    } else if (inBlock) {
      fenced.add(i);
    }
  }
  return fenced;
}

// ---- HTML comment line detection -------------------------------------------
// Pre-compute which lines are inside HTML comments (<!-- ... -->).
// Findings inside HTML comments are suppressed entirely.

function computeHtmlCommentLines(lines: string[]): Set<number> {
  const commented = new Set<number>();
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inComment) {
      if (line.includes("-->")) {
        // Closing line — don't mark it (content may follow -->)
        inComment = false;
      } else {
        // Interior line — fully inside comment
        commented.add(i);
      }
    } else if (line.includes("<!--") && !line.includes("-->")) {
      // Multi-line comment starts — don't mark opening line
      // (content may precede <!-- or follow on same line)
      inComment = true;
    }
    // Single-line <!-- ... --> comments are NOT marked to prevent
    // bypass via: <!-- --> eval("malicious")
  }
  return commented;
}

// ---- Documentation-safe patterns -------------------------------------------
// These patterns commonly fire on installation instructions and code examples
// inside fenced code blocks. Downgrade to "info" when in documentation context.

const DOCUMENTATION_SAFE_PATTERNS = new Set(["PE-001", "PE-002", "PE-003", "FS-001", "CI-008", "CT-002", "NA-001", "PI-003"]);

// ---- Markdown-link safe context for FS-003 ---------------------------------

/**
 * Returns true if the match at `matchIndex` falls inside a markdown link
 * target, i.e. between `](` and `)`.  Standard relative links like
 * `[text](../../tools/file.md)` are not path-traversal attacks.
 */
function isInsideMarkdownLink(line: string, matchIndex: number): boolean {
  const before = line.slice(0, matchIndex);
  const linkOpen = before.lastIndexOf("](");
  if (linkOpen === -1) return false;
  // Ensure the link isn't already closed before our match
  if (before.slice(linkOpen + 2).includes(")")) return false;
  // Ensure there's a closing ) after the match
  return line.indexOf(")", matchIndex) !== -1;
}

// ---- Markdown inline code detection ----------------------------------------
// Detect if a regex match falls inside markdown inline code (backticks).
// Inline code in SKILL.md is referential — it names functions/commands, not
// invokes them. Example: `eval()` in "Watch for: `eval()`, `exec()`".

/**
 * Returns true if the match at [matchStart, matchEnd) falls inside a
 * markdown inline code span (single or double backtick delimiters).
 * Fenced code block markers (```) are ignored — handled separately.
 */
function isInsideInlineCode(line: string, matchStart: number, matchEnd: number): boolean {
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") { i++; continue; }

    // Count opening backticks
    let openLen = 0;
    while (i + openLen < line.length && line[i + openLen] === "`") openLen++;
    // Skip fenced code block markers (3+ backticks)
    if (openLen >= 3) { i += openLen; continue; }

    const contentStart = i + openLen;
    const closer = "`".repeat(openLen);

    // Find matching closing backtick(s)
    const closeIdx = line.indexOf(closer, contentStart);
    if (closeIdx === -1) { i = contentStart; continue; }

    // Check if match falls within this inline code span
    if (matchStart >= contentStart && matchEnd <= closeIdx) return true;

    i = closeIdx + openLen;
  }
  return false;
}

// ---- Scanner function -----------------------------------------------------

/**
 * Scan content against all patterns, returning every match found.
 */
export function scanContent(content: string): ScanFinding[] {
  const lines = content.split("\n");
  const fencedLines = computeFencedCodeBlockLines(lines);
  const commentLines = computeHtmlCommentLines(lines);
  const findings: ScanFinding[] = [];

  for (const pattern of SCAN_PATTERNS) {
    // Reset the regex lastIndex for each pattern (they use /g flag)
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        // Suppress DCI-abuse findings for known-safe DCI patterns
        if (pattern.category === "dci-abuse" && isSafeDciBlock(line)) {
          continue;
        }

        // Suppress all findings inside HTML comments
        if (commentLines.has(lineIdx)) {
          continue;
        }

        // Suppress FS-003 path traversal inside markdown links
        if (pattern.id === "FS-003" && isInsideMarkdownLink(line, match.index)) {
          continue;
        }

        // Build context: up to 1 line before and after
        const contextLines: string[] = [];
        if (lineIdx > 0) contextLines.push(lines[lineIdx - 1]);
        contextLines.push(line);
        if (lineIdx < lines.length - 1) contextLines.push(lines[lineIdx + 1]);

        // Downgrade FS-001 severity based on context:
        // safe targets → info, system paths → keep high, other → low
        // Only for `rm` commands — rimraf() keeps base severity ("high")
        let severity = pattern.severity;
        if (pattern.id === "FS-001" && /\brm\s+-/.test(line)) {
          if (isRmTargetingSafePaths(line)) {
            severity = "info";
          } else if (!isRmTargetingSystemPaths(line)) {
            severity = "low";
          }
        }

        // Downgrade documentation-safe patterns inside fenced code blocks
        if (DOCUMENTATION_SAFE_PATTERNS.has(pattern.id) && fencedLines.has(lineIdx)) {
          severity = "info";
        }

        // Downgrade non-DCI patterns inside markdown inline code to info.
        // Inline code references (e.g., `eval()`) are educational, not invocations.
        if (pattern.category !== "dci-abuse" && isInsideInlineCode(line, match.index, match.index + match[0].length)) {
          severity = "info";
        }

        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          severity,
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
