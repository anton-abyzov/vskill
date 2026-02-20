/**
 * vskill audit -- local project security auditing command.
 *
 * Runs Tier 1 regex-based pattern scanning (and optionally LLM analysis)
 * on a local codebase to identify security vulnerabilities.
 */

import { resolve } from "node:path";
import { discoverAuditFiles } from "../audit/file-discovery.js";
import { runAuditScan } from "../audit/audit-scanner.js";
import { createDefaultAuditConfig, type AuditConfig } from "../audit/audit-types.js";
import { bold, green, red, yellow, cyan, dim, table } from "../utils/output.js";
import type { AuditFinding, AuditResult } from "../audit/audit-types.js";

export interface AuditCommandOptions {
  json?: boolean;
  ci?: boolean;
  report?: string;
  fix?: boolean;
  tier1Only?: boolean;
  exclude?: string;
  severity?: string;
  maxFiles?: string;
}

/**
 * Execute the audit command.
 *
 * @param targetPath - Directory or file to audit (default: ".")
 * @param opts - CLI options
 */
export async function auditCommand(
  targetPath: string,
  opts: AuditCommandOptions,
): Promise<void> {
  const resolvedPath = resolve(targetPath || ".");

  // Build config from defaults + CLI flags
  const config = createDefaultAuditConfig();
  if (opts.tier1Only) config.tier1Only = true;
  if (opts.fix) config.fix = true;
  if (opts.exclude) config.excludePaths = opts.exclude.split(",");
  if (opts.severity) config.severityThreshold = opts.severity as AuditConfig["severityThreshold"];
  if (opts.maxFiles) config.maxFiles = parseInt(opts.maxFiles, 10);

  // Discover files
  const files = await discoverAuditFiles(resolvedPath, config);

  if (files.length === 0) {
    console.log(yellow("No scannable files found."));
    process.exit(0);
    return;
  }

  // Run Tier 1 scan
  const result = runAuditScan(files, config);
  result.rootPath = resolvedPath;

  // Output based on format flag
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.ci) {
    // SARIF output (placeholder until formatter is ready)
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTerminalOutput(result);
  }

  // Exit code: 0=PASS, 1=CONCERNS, 2=FAIL
  if (result.summary.verdict === "FAIL") process.exit(2);
  else if (result.summary.verdict === "CONCERNS") process.exit(1);
  else process.exit(0);
}

function printTerminalOutput(result: AuditResult): void {
  const verdictColor =
    result.summary.verdict === "PASS" ? green
    : result.summary.verdict === "CONCERNS" ? yellow
    : red;

  console.log(bold("\nvskill audit\n"));
  console.log(
    `${bold("Score:")} ${verdictColor(String(result.summary.score))}/100  ` +
    `${bold("Verdict:")} ${verdictColor(result.summary.verdict)}  ` +
    `${bold("Files:")} ${result.filesScanned}  ` +
    `${bold("Time:")} ${result.durationMs}ms\n`,
  );

  if (result.findings.length === 0) {
    console.log(green("No security issues found.\n"));
    return;
  }

  // Summary line
  const parts = [
    result.summary.critical > 0 ? red(`${result.summary.critical} critical`) : null,
    result.summary.high > 0 ? yellow(`${result.summary.high} high`) : null,
    result.summary.medium > 0 ? cyan(`${result.summary.medium} medium`) : null,
    result.summary.low > 0 ? dim(`${result.summary.low} low`) : null,
    result.summary.info > 0 ? dim(`${result.summary.info} info`) : null,
  ].filter(Boolean).join("  ");

  console.log(`${bold("Findings:")} ${parts}\n`);

  // Findings table
  const headers = ["Severity", "Rule", "File", "Line", "Message"];
  const rows = result.findings.map((f) => {
    const sevColor =
      f.severity === "critical" ? red
      : f.severity === "high" ? yellow
      : f.severity === "medium" ? cyan
      : dim;
    return [
      sevColor(f.severity.toUpperCase()),
      dim(f.ruleId),
      f.filePath,
      String(f.line),
      f.message.substring(0, 60),
    ];
  });

  console.log(table(headers, rows));
}
