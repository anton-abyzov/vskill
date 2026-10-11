// ---------------------------------------------------------------------------
// Tier 1 Security Scan Patterns
// 58 regex-based patterns for static analysis of skill content, plus the
// hidden-content checks (HC-*) in hidden-content.ts.
// ---------------------------------------------------------------------------

import { HIDDEN_CONTENT_RULES, scanHiddenContent } from "./hidden-content.js";
import { DOT_SEGMENT_URL_SOURCE, OFFICIAL_INSTALLER_URL_SOURCE } from "./installer-hosts.js";

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
  /** Original pattern severity when context rules lowered it. */
  downgradedFrom?: PatternSeverity;
  /**
   * Matches folded into this finding, when more than one: the same pattern,
   * line and severity, plus any findings folded in past the caps.
   */
  occurrences?: number;
  /**
   * Findings of the same pattern and severity folded into this one past the
   * per-pattern or total cap. Severity counts and scores include them.
   */
  foldedFindings?: number;
}

// ---- Shared fragments ------------------------------------------------------

/**
 * netcat in command position: at the start of a line or string or after a
 * list marker or shell prompt there, after a shell separator, colon, quote,
 * backtick or `$(`, or after a wrapper or verb such as sudo, nohup,
 * timeout N, run or Run; an absolute path is allowed. No fragment repeats and
 * no whitespace run crosses a newline, so a long line or a run of blank lines
 * is scanned in one pass.
 */
const NETCAT_COMMAND = String.raw`(?:^|^[^\S\n]*(?:[-*+>$#]|\d+[.)])(?=\s)|[\n|;&(\x60'":]|\$\(|\b(?:sudo|doas|busybox|nohup|exec|env|command|time|then|do|[Rr]un|[Ee]xecute)(?=\s)|\btimeout[^\S\n]+[\w.]+(?=\s))[^\S\n]*(?:(?:\/[\w.-]+)*\/)?(?:nc|ncat|netcat)\b`;

/**
 * An official installer URL start with no dot segment in reach: a dot
 * segment can climb out of an allowlisted owner's path on
 * raw.githubusercontent.com, so such a URL is not official.
 */
const OFFICIAL_INSTALLER_URL_SOURCE_NO_DOT_SEGMENTS = `(?!${DOT_SEGMENT_URL_SOURCE})(?:${OFFICIAL_INSTALLER_URL_SOURCE})`;

/** A filesystem API call opening its argument list (FS-003). */
const FS_CALL = String.raw`(?:readFile|writeFile|appendFile|createReadStream|createWriteStream|open|unlink|stat|lstat|fstat|access|rename|copyFile|chmod|chown|truncate)(?:Sync)?\s*\(`;

// ---- Patterns (58 total) --------------------------------------------------

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
    pattern: /exec\s*\((?:(?!exec\s*\()[^)|\n])*\|(?:(?!exec\s*\()[^)\n])*\)/g,
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
    // Each scan stops at the next curl/wget, so a pipe-free run costs one
    // pass however many times the command repeats, and padding cannot hide the pipe.
    pattern: /\b(?:curl|wget)\b(?:(?!\b(?:curl|wget)\b)[^|\n])*\|\s*(?:(?:\/\w+)*\/)?(?:env\s+)?(?:ba|z|da|k)?sh\b/g,
    category: "command-injection",
  },

  {
    id: "CI-009",
    name: "Python shell execution",
    severity: "high",
    description: "Detects os.system/os.popen and subprocess calls with shell=True",
    // os.system( is already CI-003 ("system("); only the spaced form is added.
    pattern: /\bos\.popen\s*\(|\bos\.system\s+\(|\bsubprocess\.(?:run|call|Popen|check_output|check_call)\s*\([^)]{0,400}?\bshell\s*=\s*True/g,
    category: "command-injection",
  },
  {
    id: "CI-010",
    name: "PowerShell dynamic execution",
    severity: "high",
    description: "Detects Invoke-Expression/iex, -EncodedCommand payloads and base64 decoding in PowerShell",
    pattern: /\bInvoke-Expression\b|\|\s*iex\b|\biex\s*\(\s*(?:\(|\$|\[|['"]|New-Object\b|Invoke-|i(?:wr|rm)\b|Get-Content\b)|\s-(?:EncodedCommand|enc|ec)\s+[A-Za-z0-9+\/=]{20,}|\[(?:System\.)?Convert\]::FromBase64String/gi,
    category: "command-injection",
  },
  {
    // CLI-only: the PowerShell twin of CI-008. A CI-010 match inside this
    // span is reported as CI-011 instead, so installer docs in fenced code
    // (irm bun.sh/install.ps1 | iex) get the same downgrade as curl | sh.
    // The download target must be literal: a $variable URL stays CI-010.
    id: "CI-011",
    name: "PowerShell download-and-execute",
    severity: "critical",
    description: "Detects irm/iwr output piped to iex, or iex of a downloaded script (PowerShell installer one-liners)",
    pattern: /\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^|\n$]{1,400}\|\s*(?:iex|Invoke-Expression)\b|\b(?:iex|Invoke-Expression)\s*\(?\s*\(\s*(?:(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^()\n$]{1,400}|New-Object\s+(?:System\.)?Net\.WebClient\s*\)\s*\.DownloadString\s*\(\s*['"]https?:\/\/[^()\n$'"]{1,400}['"]\s*)\)/gi,
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
    // Scans like this one stop at the next call of the same function, so a
    // repeated prefix cannot make a long line quadratic, and no length bound
    // lets padding hide the rest of the call.
    pattern: /dns\.(?:resolve|lookup)\s*\((?:(?!dns\.(?:resolve|lookup)\b)[^\n])*?(?:\+|concat|\$\{)/g,
    category: "data-exfiltration",
  },
  {
    id: "DE-005",
    name: "Base64 encode and send",
    severity: "medium",
    description: "Detects base64 encoding followed by network send (exfil pattern)",
    pattern: /btoa\s*\(|Buffer\.from\((?:(?!Buffer\.from\()[^)\n])*\)\.toString\s*\(\s*['"]base64['"]/g,
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
    pattern: /readFile(?:Sync)?\s*\((?:(?!readFile)[^)\n])*?\.env\b/g,
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
    pattern: /security\s+find-(?:generic|internet)-password|security\s+(?:default-|login-|delete-|export-|import-|show-)?keychain|SecKeychain\w*|keychain\s*[.(]|credential-store/g,
    category: "credential-theft",
  },
  {
    id: "CT-005",
    name: "Secrets in environment",
    severity: "high",
    description: "Detects broad process.env access patterns",
    pattern: /process\.env\[(?:(?:(?!process\.env\[)[^'"\]\n])*\+|[a-zA-Z_]\w*\])/g,
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
    pattern: /writeFile(?:Sync)?\s*\((?:(?!writeFile)[^)\n])*?(?:\/etc\/|\/usr\/|\/var\/|\/System\/|C:\\Windows)/g,
    category: "filesystem-access",
  },
  {
    id: "FS-003",
    name: "Path traversal",
    severity: "high",
    description: "Detects directory traversal in filesystem API call arguments",
    pattern: new RegExp(String.raw`${FS_CALL}(?:(?!${FS_CALL})[^)\n])*\.\.[/\\]\.\.[/\\]`, "g"),
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
    // A flag or shell pipe after the host only counts when netcat is the
    // command itself, and the argument run stops at the first | ; or &, so
    // `nc -z db 5432 && psql -c ...` and prose about `wc -c` stay clean.
    pattern: new RegExp(
      String.raw`(?:\/dev\/tcp\/|\b(?:nc|netcat)\s+-[a-z]*e|\bncat\b\s+-|${NETCAT_COMMAND}[^\n|;&]{0,160}?\s(?:-e|-c|--exec|--sh-exec)\b|${NETCAT_COMMAND}[^\n|;&]{0,160}\|\s*(?:(?:\/\w+)*\/)?(?:ba|z|da|k)?sh\b|bash\s+-i\s+>&|mkfifo\s+\S|0<&\d+)`,
      "g",
    ),
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

  {
    id: "NA-004",
    name: "Fake prerequisite download",
    severity: "high",
    description: "Detects instructions to download and run an external binary or script as a setup step (ClawHavoc-style)",
    pattern: new RegExp(
      String.raw`\b(?:before (?:using|running|installing)|prerequisites?|required?|first)\b[^.\n]{0,120}?\b(?:download|install|run|execute)\b[^\n]{0,160}?(?:https?:\/\/(?!${OFFICIAL_INSTALLER_URL_SOURCE_NO_DOT_SEGMENTS})[^\/\s)'"\x60]{1,253}\/[^\s)'"\x60]{0,400}?\.(?:zip|exe|dmg|pkg|msi|sh|ps1|bat|cmd|command|app|scr)\b|\b(?:glot\.io|pastebin\.com|rentry\.co|paste\.ee|transfer\.sh|hastebin\.com)\/)`,
      "gi",
    ),
    category: "network-access",
  },
  {
    id: "NA-005",
    name: "Password-protected archive",
    severity: "high",
    description: "Detects password-protected archives, a common way to hide payloads from scanners",
    // No /i flag: unzip -P is the password but -p pipes to stdout.
    pattern: /\b(?:[Zz][Ii][Pp]|[Aa][Rr][Cc][Hh][Ii][Vv][Ee]|[Rr][Aa][Rr]|7[Zz])\b[^\n]{0,80}?\b[Pp][Aa][Ss][Ss](?:[Ww][Oo][Rr][Dd]|[Cc][Oo][Dd][Ee])\s*(?:[Ii][Ss]\s*)?[:=]\s*\S+|\bunzip\b[^|&;\n]{0,60}?\s-[a-zA-Z]*P\s*\S+|\b(?:7z|7za|7zz|unrar)\s+[ex]\b[^|&;\n]{0,60}?\s-[pP]\S+/g,
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

  {
    id: "CE-004",
    name: "Python dynamic execution or deserialization",
    severity: "high",
    description: "Detects pickle/marshal loads and exec() of decoded or compiled code",
    pattern: /\b(?:pickle|cPickle|_pickle|marshal|dill)\.loads?\s*\(|\bexec\s*\(\s*(?:compile|base64|codecs|zlib|bytes\.fromhex|marshal|__import__)\b|\b__import__\s*\(\s*['"](?:os|subprocess|socket|pty)['"]\s*\)/g,
    category: "code-execution",
  },

  // --- DCI Block Abuse (38-51) -----------------------------------------------
  {
    id: "DCI-001",
    name: "DCI credential file read",
    severity: "critical",
    description: "DCI block reads credential files (~/.ssh/, ~/.aws/, .env)",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*(?:~\/\.ssh\/|~\/\.aws\/|\.env\b|\.gnupg\/)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-002",
    name: "DCI network exfiltration",
    severity: "critical",
    description: "DCI block uses curl/wget for network access",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\b(?:curl|wget)\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-003",
    name: "DCI fetch/nc network call",
    severity: "critical",
    description: "DCI block uses fetch or netcat for network access",
    // `git fetch` and other package-manager fetch subcommands are not network
    // calls the skill makes. The lookbehind runs only where `fetch` matched.
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*(?:\bfetch\b(?<!\b(?:git|npm|pnpm|yarn)\s+fetch)|\b(?:nc|ncat|netcat)\b)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-004",
    name: "DCI agent config write",
    severity: "critical",
    description: "DCI block writes to agent config files (CLAUDE.md, AGENTS.md, .claude/)",
    // The prefix cannot pass a `>`, so only the first redirect is tried: a
    // later target also follows it, and the line is scanned once.
    pattern: /^[^\S\n]*![^\S\n]*`[^`>\n]*>[^`\n]*(?:CLAUDE\.md|AGENTS\.md|\.claude\/|\.specweave\/)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-005",
    name: "DCI agent config modify",
    severity: "critical",
    description: "DCI block modifies agent config via tee/sed/echo append",
    // Each tee/sed -i scan stops at the next one, each echo scan at the next
    // echo, and each `>>` scan at the next `>>`: linear with no length bound.
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*?(?:(?:\btee\b|\bsed\s+-i)(?:(?!\btee\b|\bsed\s+-i)[^`\n])*|\becho\s(?:(?!\becho\s)[^`\n])*?>>(?:(?!>>)[^`\n])*)(?:CLAUDE\.md|AGENTS\.md|\.claude\/)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-006",
    name: "DCI base64 decode",
    severity: "critical",
    description: "DCI block contains base64 decoding (obfuscation)",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\b(?:base64\s+(?:-[dD]|--decode)|atob\s*\()/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-007",
    name: "DCI hex escape obfuscation",
    severity: "critical",
    description: "DCI block contains hex escape sequences (obfuscation)",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){3,}/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-008",
    name: "DCI eval execution",
    severity: "critical",
    description: "DCI block uses eval for code execution",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\beval\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-009",
    name: "DCI download and execute",
    severity: "critical",
    description: "DCI block pipes downloaded content to shell (download-and-execute)",
    // The prefix stops at the first curl/wget; a later shell pipe also
    // follows it, so one pass decides the line.
    pattern: /^[^\S\n]*![^\S\n]*`(?:(?!\b(?:curl|wget)\b)[^`\n])*\b(?:curl|wget)\b[^`\n]*\|\s*(?:ba|z|da|k)?sh\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-010",
    name: "DCI reverse shell",
    severity: "critical",
    description: "DCI block establishes a reverse shell connection",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*(?:\/dev\/tcp\/|bash\s+-i\s+>&|mkfifo|nc\s+-[a-z]*e)/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-011",
    name: "DCI sudo escalation",
    severity: "critical",
    description: "DCI block uses sudo for privilege escalation",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\bsudo\b/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-012",
    name: "DCI rm destructive command",
    severity: "critical",
    description: "DCI block executes destructive rm -rf command",
    pattern: /^[^\S\n]*![^\S\n]*`[^`\n]*\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-013",
    name: "DCI home dir exfiltration",
    severity: "critical",
    description: "DCI block reads from home directory sensitive paths",
    // Independent lookaheads with no length bound, so padding cannot push the
    // path out of reach; each /home/ scan stops at the next /home/.
    pattern: /^[^\S\n]*![^\S\n]*`(?=[^`\n]*\b(?:cat|less|head|tail|strings)\s)(?=[^`\n]*(?:~\/\.|\/home\/(?:(?!\/home\/)[^`\s])*\.))/gm,
    category: "dci-abuse",
  },
  {
    id: "DCI-014",
    name: "DCI data pipe to network",
    severity: "critical",
    description: "DCI block pipes local data to a network command",
    pattern: /^[^\S\n]*![^\S\n]*`(?=[^`\n]*\b(?:cat|tar|zip)\s)(?=[^`\n]*\|\s*(?:curl|wget|nc)\b)/gm,
    category: "dci-abuse",
  },
];

// ---- Safe-context patterns for DCI blocks ----------------------------------
// The canonical skill-memories lookup is a known-safe DCI pattern.
// Suppress DCI-abuse findings when the line matches this pattern AND
// no malicious DCI pattern also matches (prevents appended-command bypass).

const SAFE_DCI_PATTERNS: RegExp[] = [
  /^[^\S\n]*![^\S\n]*`for\s+d\s+in\s+\.specweave\/skill-memories/,
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

// ---- Documentation-safe patterns -------------------------------------------
// These patterns commonly fire on installation instructions and code examples
// inside fenced code blocks. Downgrade to "info" when in documentation context.

// NA-004/NA-005 are deliberately absent: fake-prerequisite and password-archive
// lures are written as prose, so documentation context must not hide them.
const DOCUMENTATION_SAFE_PATTERNS = new Set([
  "PE-001", "PE-002", "PE-003", "FS-001", "CI-008", "CI-009", "CI-010", "CI-011",
  "CE-004", "CT-002", "CT-004", "NA-001", "PI-003",
]);

// CI-010 forms that run hidden or computed code keep their severity even in a
// fenced example: an -EncodedCommand payload, base64 decoded on a line that
// also executes, and Invoke-Expression/iex of a variable or a download.
const CI010_ENCODED_RE = /^\s-(?:EncodedCommand|enc|ec)\s/i;
const CI010_EXEC_SINK_RE = /\b(?:iex|Invoke-Expression|Invoke-Command|Start-Process|powershell|pwsh)\b|\[ScriptBlock\]::Create|\.Invoke\s*\(|&\s*\(/i;
const CI010_COMPUTED_RE = /\$[\w{(:]|DownloadString|FromBase64String|GetString|\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b/i;

function ci010KeepsSeverity(match: string, line: string): boolean {
  if (CI010_ENCODED_RE.test(match)) return true;
  if (/FromBase64String/i.test(match)) return CI010_EXEC_SINK_RE.test(line);
  return CI010_COMPUTED_RE.test(line);
}

// ---- Markdown inline code detection ----------------------------------------
// Detect if a regex match falls inside markdown inline code (backticks).
// Inline code in SKILL.md is referential — it names functions/commands, not
// invokes them. Example: `eval()` in "Watch for: `eval()`, `exec()`".

/**
 * The [contentStart, contentEnd) ranges of markdown inline code spans (single
 * or double backtick delimiters) on a line, in order. Fenced code block
 * markers (```) are ignored — handled separately. Computed once per line so
 * many matches on one long line stay linear.
 */
function inlineCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick < 0) break;
    i = tick;

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

    spans.push([contentStart, closeIdx]);
    i = closeIdx + openLen;
  }
  return spans;
}

// ---- Finding context ---------------------------------------------------------

// Each context line is cut to a window around the match column, so a match on
// a huge line costs O(window), not O(line).

const CONTEXT_WINDOW = 300;

function contextWindow(text: string, column: number): string {
  if (text.length <= CONTEXT_WINDOW) return text;
  let start = Math.max(0, Math.min(column - CONTEXT_WINDOW / 2, text.length - CONTEXT_WINDOW));
  let end = start + CONTEXT_WINDOW;
  // Never split a surrogate pair.
  const high = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
  if (start > 0 && high(text.charCodeAt(start - 1))) start++;
  if (end < text.length && high(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

// ---- CI-010 vs CI-011 -------------------------------------------------------
// CI-011 (PowerShell download-and-execute) is a more specific form of CI-010.
// A CI-010 match inside a CI-011 span is dropped so the installer one-liner is
// reported once, under the id that gets the documentation-context downgrade.

/** Longest rescanned-payload match kept on a finding. */
const MAX_PAYLOAD_MATCH = 200;

const INSTALLER_SOURCE = SCAN_PATTERNS.find((p) => p.id === "CI-011")!.pattern;

function installerSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = new RegExp(INSTALLER_SOURCE.source, INSTALLER_SOURCE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/** True if [start, end) lies inside one of the sorted, non-overlapping spans. */
function insideSpan(spans: Array<[number, number]>, start: number, end: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][0] <= start) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 && end <= spans[hi][1];
}

// ---- Finding caps -------------------------------------------------------------
// A 2MB file of one repeated match must not become hundreds of thousands of
// findings. Past the caps a finding folds into the latest one of the same
// pattern and severity; one is still listed when no such finding exists, so
// a new severity is never lost.

const MAX_FINDINGS_PER_PATTERN = 100;
const MAX_FINDINGS = 2000;

// Decoded payloads are rescanned up to these limits; the rest are reported
// as one HC-010 marker so the judge knows they were not rescanned.
const MAX_RESCAN_PAYLOADS = 50;
const MAX_RESCAN_CHARS = 64 * 1024;

const UNSCANNED_RULE = HIDDEN_CONTENT_RULES.find((r) => r.id === "HC-010")!;

/** Adds findings to `out` under the caps; `add` returns the finding that holds the new one. */
function cappedFindings(out: ScanFinding[]): (finding: ScanFinding) => ScanFinding {
  const listed = new Map<string, number>();
  const latest = new Map<string, ScanFinding>();
  return (finding) => {
    const key = `${finding.patternId}:${finding.severity}`;
    const count = listed.get(finding.patternId) ?? 0;
    const holder = latest.get(key);
    if (holder && (count >= MAX_FINDINGS_PER_PATTERN || out.length >= MAX_FINDINGS)) {
      holder.occurrences = (holder.occurrences ?? 1) + (finding.occurrences ?? 1);
      holder.foldedFindings = (holder.foldedFindings ?? 0) + 1 + (finding.foldedFindings ?? 0);
      return holder;
    }
    out.push(finding);
    listed.set(finding.patternId, count + 1);
    latest.set(key, finding);
    return finding;
  };
}

// ---- Scanner function -----------------------------------------------------

/**
 * Scan content against all patterns, returning every match found.
 */
export function scanContent(content: string): ScanFinding[] {
  const lines = content.split("\n");
  const fencedLines = computeFencedCodeBlockLines(lines);
  const findings: ScanFinding[] = [];
  const add = cappedFindings(findings);
  const installerSpanCache = new Map<number, Array<[number, number]>>();
  const inlineCodeCache = new Map<number, Array<[number, number]>>();
  const safeDciCache = new Map<number, boolean>();
  const rmSeverityCache = new Map<number, PatternSeverity | null>();

  for (const pattern of SCAN_PATTERNS) {
    // Reset the regex lastIndex for each pattern (they use /g flag)
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let match: RegExpExecArray | null;
      // One finding per severity for this pattern on this line; further
      // matches only raise its occurrence count.
      let folded: Map<PatternSeverity, ScanFinding> | null = null;

      while ((match = regex.exec(line)) !== null) {
        // Guard against zero-length matches looping forever on a /g regex.
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }

        // Suppress DCI-abuse findings for known-safe DCI patterns
        if (pattern.category === "dci-abuse") {
          let safe = safeDciCache.get(lineIdx);
          if (safe === undefined) safeDciCache.set(lineIdx, (safe = isSafeDciBlock(line)));
          if (safe) continue;
        }

        // HTML comments are NOT suppressed: they render invisibly to a human
        // reviewer but an agent reads them verbatim, so they are where hidden
        // instructions go. hidden-content.ts adds HC-005 for directive bodies.

        if (pattern.id === "CI-010") {
          let spans = installerSpanCache.get(lineIdx);
          if (!spans) installerSpanCache.set(lineIdx, (spans = installerSpans(line)));
          if (insideSpan(spans, match.index, match.index + match[0].length)) continue;
        }

        // Downgrade FS-001 severity based on context:
        // safe targets → info, system paths → keep high, other → low
        // Only for `rm` commands — rimraf() keeps base severity ("high")
        let severity = pattern.severity;
        if (pattern.id === "FS-001") {
          let rmSeverity = rmSeverityCache.get(lineIdx);
          if (rmSeverity === undefined) {
            rmSeverity = !/\brm\s+-/.test(line)
              ? null
              : isRmTargetingSafePaths(line)
                ? "info"
                : isRmTargetingSystemPaths(line)
                  ? null
                  : "low";
            rmSeverityCache.set(lineIdx, rmSeverity);
          }
          if (rmSeverity) severity = rmSeverity;
        }

        // Downgrade documentation-safe patterns inside fenced code blocks
        if (
          DOCUMENTATION_SAFE_PATTERNS.has(pattern.id) &&
          fencedLines.has(lineIdx) &&
          !(pattern.id === "CI-010" && ci010KeepsSeverity(match[0], line))
        ) {
          severity = "info";
        }

        // Downgrade non-DCI patterns inside markdown inline code to info.
        // Inline code references (e.g., `eval()`) are educational, not invocations.
        if (pattern.category !== "dci-abuse") {
          let spans = inlineCodeCache.get(lineIdx);
          if (!spans) inlineCodeCache.set(lineIdx, (spans = inlineCodeSpans(line)));
          if (insideSpan(spans, match.index, match.index + match[0].length)) severity = "info";
        }

        const prior = folded?.get(severity);
        if (prior) {
          prior.occurrences = (prior.occurrences ?? 1) + 1;
          continue;
        }

        // Build context: up to 1 line before and after, each windowed
        // around the match column.
        const contextLines: string[] = [];
        if (lineIdx > 0) contextLines.push(contextWindow(lines[lineIdx - 1], match.index));
        contextLines.push(contextWindow(line, match.index));
        if (lineIdx < lines.length - 1) contextLines.push(contextWindow(lines[lineIdx + 1], match.index));

        const finding: ScanFinding = {
          patternId: pattern.id,
          patternName: pattern.name,
          severity,
          ...(severity !== pattern.severity ? { downgradedFrom: pattern.severity } : {}),
          category: pattern.category,
          match: match[0],
          lineNumber: lineIdx + 1,
          context: contextLines.join("\n"),
        };
        // Later matches on this line go to whichever finding now holds it.
        (folded ??= new Map()).set(severity, add(finding));
      }
    }
  }

  // Hidden channels: invisible Unicode, comment directives, encoded text.
  // Decoded payloads are rescanned at full severity: hidden text gets no
  // documentation-context downgrade.
  const hidden = scanHiddenContent(content);
  const extra: ScanFinding[] = [...hidden.findings];
  let budget = MAX_RESCAN_CHARS;
  for (const [index, payload] of hidden.payloads.entries()) {
    if (index >= MAX_RESCAN_PAYLOADS || budget <= 0) {
      const skipped = hidden.payloads.length - index;
      extra.push({
        patternId: UNSCANNED_RULE.id,
        patternName: UNSCANNED_RULE.name,
        severity: UNSCANNED_RULE.severity,
        category: "prompt-injection",
        match: `[vskill: ${skipped} decoded payload${skipped === 1 ? "" : "s"} not rescanned]`,
        lineNumber: payload.lineNumber,
        context: "",
      });
      break;
    }
    // The whole decoded text is rescanned (within the budget), not the
    // display copy.
    const text = payload.text.length > budget ? payload.text.slice(0, budget) : payload.text;
    budget -= text.length;
    const spans = installerSpans(text);
    for (const pattern of SCAN_PATTERNS) {
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;
      let first: ScanFinding | null = null;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        if (pattern.id === "CI-010" && insideSpan(spans, match.index, match.index + match[0].length)) continue;
        if (first) {
          first.occurrences = (first.occurrences ?? 1) + 1;
          continue;
        }
        first = {
          patternId: pattern.id,
          patternName: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          match: `[hidden ${payload.kind}] ${match[0].slice(0, MAX_PAYLOAD_MATCH)}`,
          lineNumber: payload.lineNumber,
          context: contextWindow(text, match.index),
        };
        extra.push(first);
      }
    }
  }
  for (const finding of extra) add(finding);

  return findings;
}
