// ---------------------------------------------------------------------------
// 0894: fetch + scan the complete folder of a GitHub skill for `vskill install`.
//
// Text files go through the same Tier-1 scanner as SKILL.md. A CRITICAL
// finding in any bundled file blocks the install (unless --force); lower
// severities are reported but do not block, because skill tooling scripts
// legitimately spawn processes and clean temp folders. Binaries pass through.
// ---------------------------------------------------------------------------

import {
  fetchGitHubSkillBundle,
  bundleTextFiles,
  SkillBundleError,
  type FetchSkillBundleArgs,
  type GitHubSkillBundle,
} from "../discovery/github-skill-bundle.js";
import { runTier1Scan } from "../scanner/index.js";
import { dim, red, yellow } from "../utils/output.js";

export interface BundleScanReport {
  /** Files with at least one CRITICAL finding: these block the install. */
  critical: Array<{ path: string; findings: string[] }>;
  /** Files whose findings are high/medium/low only. */
  flagged: string[];
}

export function scanSkillBundle(files: GitHubSkillBundle["files"]): BundleScanReport {
  const report: BundleScanReport = { critical: [], flagged: [] };
  for (const [path, text] of bundleTextFiles(files)) {
    const result = runTier1Scan(text);
    const crit = result.findings.filter((f) => f.severity === "critical");
    if (crit.length > 0) {
      report.critical.push({
        path,
        findings: crit.map((f) => `${f.patternId} ${f.patternName} (line ${f.lineNumber})`),
      });
    } else if (result.findings.some((f) => f.severity !== "info")) {
      report.flagged.push(path);
    }
  }
  return report;
}

export type PreparedBundle =
  | { ok: true; bundle: GitHubSkillBundle }
  | { ok: false; verdict: "BUNDLE_ERROR" | "FAIL"; message: string };

/**
 * Download the whole skill folder and scan its text files. Never returns a
 * partial bundle: limits, truncated listings and failed downloads come back
 * as `ok: false` with a message for the user.
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

  const scan = scanSkillBundle(bundle.files);
  if (scan.flagged.length > 0) {
    const list = scan.flagged.slice(0, 5).join(", ") + (scan.flagged.length > 5 ? ", ..." : "");
    console.log(dim(`  Non-critical scan findings in ${scan.flagged.length} bundled file(s): ${list}`));
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
        message: `CRITICAL findings in ${scan.critical.length} bundled file(s):\n${lines}\n  Use --force to install anyway (not recommended).`,
      };
    }
    console.log(red(`  --force: installing despite CRITICAL findings in bundled files:\n${lines}`));
  }
  return { ok: true, bundle };
}
