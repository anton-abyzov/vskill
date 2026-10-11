// ---------------------------------------------------------------------------
// 0894: fetch + scan the complete folder of a GitHub skill for `vskill install`.
//
// Every bundled file goes through the same Tier-1 scanner as SKILL.md. Text
// is scanned as-is; files that are not valid UTF-8 are scanned lossily, so a
// stray NUL or 0xFF byte cannot hide `curl … | bash` from the scan.
//
// Blocking (unless --force):
//   - a CRITICAL finding in a text file;
//   - a CRITICAL finding in an undecodable file that looks like a script
//     (git mode 100755, a `#!` shebang, or a script extension);
//   - a native executable (ELF, Mach-O, PE, .node/.so/.dylib/.dll/.exe),
//     which no static scan can vouch for.
// Lower severities are reported, not blocking: skill tooling scripts
// legitimately spawn processes and clean temp folders. Other binaries
// (fonts, audio, images) pass through.
// ---------------------------------------------------------------------------

import {
  fetchGitHubSkillBundle,
  SkillBundleError,
  type FetchSkillBundleArgs,
  type GitHubSkillBundle,
} from "../discovery/github-skill-bundle.js";
import { runTier1Scan } from "../scanner/index.js";
import { dim, red, yellow } from "../utils/output.js";

export interface BundleScanReport {
  /** Files that block the install without --force, with the reasons. */
  critical: Array<{ path: string; findings: string[] }>;
  /** Files with non-blocking findings. */
  flagged: string[];
}

const SCRIPT_EXTENSIONS = /\.(sh|bash|zsh|fish|ksh|py|pyw|rb|pl|php|js|mjs|cjs|ts|mts|cts|ps1|psm1|bat|cmd|vbs|lua|tcl|applescript|command)$/i;
const NATIVE_EXTENSIONS = /\.(node|so|dylib|dll|exe)$/i;

/** ELF, Mach-O (thin + fat) or PE/COFF header. */
export function isNativeExecutable(path: string, bytes: Uint8Array): boolean {
  if (NATIVE_EXTENSIONS.test(path)) return true;
  if (bytes.byteLength < 4) return false;
  const [a, b, c, d] = bytes;
  if (a === 0x7f && b === 0x45 && c === 0x4c && d === 0x46) return true; // \x7fELF
  const be = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(be)) return true;
  if (a === 0x4d && b === 0x5a && bytes.byteLength >= 64) return true; // MZ
  return false;
}

function looksLikeScript(path: string, bytes: Uint8Array, executable: boolean): boolean {
  return executable || (bytes[0] === 0x23 && bytes[1] === 0x21) || SCRIPT_EXTENSIONS.test(path);
}

function criticalOf(text: string): string[] {
  return runTier1Scan(text).findings
    .filter((f) => f.severity === "critical")
    .map((f) => `${f.patternId} ${f.patternName} (line ${f.lineNumber})`);
}

function hasFindings(text: string): boolean {
  return runTier1Scan(text).findings.some((f) => f.severity !== "info");
}

export function scanSkillBundle(
  files: GitHubSkillBundle["files"],
  executables: readonly string[] = [],
): BundleScanReport {
  const report: BundleScanReport = { critical: [], flagged: [] };
  const exec = new Set(executables);
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof content === "string") {
      const crit = criticalOf(content);
      if (crit.length > 0) report.critical.push({ path, findings: crit });
      else if (hasFindings(content)) report.flagged.push(path);
      continue;
    }
    if (isNativeExecutable(path, content)) {
      report.critical.push({ path, findings: ["native executable: cannot be scanned"] });
      continue;
    }
    const scriptLike = looksLikeScript(path, content, exec.has(path));
    let text: string;
    try {
      // Lossy: invalid sequences become U+FFFD, NULs are dropped so they
      // cannot split a pattern such as `cu\0rl | bash`.
      text = new TextDecoder("utf-8").decode(content).replace(/\0/g, "");
    } catch {
      if (scriptLike) report.critical.push({ path, findings: ["script that cannot be scanned"] });
      continue;
    }
    const crit = criticalOf(text);
    if (crit.length > 0 && scriptLike) report.critical.push({ path, findings: crit });
    else if (crit.length > 0 || (scriptLike && hasFindings(text))) report.flagged.push(path);
  }
  return report;
}

export type PreparedBundle =
  | { ok: true; bundle: GitHubSkillBundle }
  | { ok: false; verdict: "BUNDLE_ERROR" | "FAIL"; message: string };

/**
 * Download the skill folder and scan it. A failed download, a case
 * collision or a blocking finding comes back as `ok: false`; an unlistable
 * or over-limit folder comes back degraded with a warning printed.
 */
export async function prepareGitHubSkillBundle(
  args: FetchSkillBundleArgs & { force?: boolean },
): Promise<PreparedBundle> {
  let bundle: GitHubSkillBundle;
  try {
    bundle = await fetchGitHubSkillBundle(args);
  } catch (err) {
    const message = err instanceof SkillBundleError
      ? err.message
      : `Could not fetch the skill folder: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, verdict: "BUNDLE_ERROR", message };
  }

  if (bundle.degraded) {
    console.log(
      yellow(
        `  WARNING: could not install the complete skill folder (${bundle.degraded}).\n` +
          `  Installed SKILL.md and up to 100 files from its standard folders; the skill may be incomplete.`,
      ),
    );
  }
  const binaries = Object.values(bundle.files).filter((v) => typeof v !== "string").length;
  console.log(
    dim(
      `  Skill folder: ${bundle.fileList.length} file${bundle.fileList.length === 1 ? "" : "s"}` +
        (binaries > 0 ? ` (${binaries} binary)` : "") +
        (bundle.executables.length > 0 ? `, ${bundle.executables.length} executable` : ""),
    ),
  );
  for (const s of bundle.skipped) {
    console.log(yellow(`  Not installed: ${s.path} (${s.reason})`));
  }

  const scan = scanSkillBundle(bundle.files, bundle.executables);
  if (scan.flagged.length > 0) {
    const list = scan.flagged.slice(0, 5).join(", ") + (scan.flagged.length > 5 ? ", ..." : "");
    console.log(dim(`  Non-blocking scan findings in ${scan.flagged.length} bundled file(s): ${list}`));
  }
  if (scan.critical.length > 0) {
    const lines = scan.critical
      .slice(0, 10)
      .map((c) => `    ${c.path}: ${c.findings.slice(0, 3).join("; ")}`)
      .join("\n");
    if (!args.force) {
      return {
        ok: false,
        verdict: "FAIL",
        message: `Blocking findings in ${scan.critical.length} bundled file(s):\n${lines}\n  Use --force to install anyway (not recommended).`,
      };
    }
    console.log(red(`  --force: installing despite blocking findings in bundled files:\n${lines}`));
  }
  return { ok: true, bundle };
}
