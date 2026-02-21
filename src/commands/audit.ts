/**
 * vskill audit -- local project security auditing command.
 *
 * Runs Tier 1 regex-based pattern scanning on a local codebase
 * to identify security vulnerabilities.
 */

import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { discoverAuditFiles } from "../audit/file-discovery.js";
import { runAuditScan } from "../audit/audit-scanner.js";
import { createDefaultAuditConfig, type AuditConfig, type Severity } from "../audit/audit-types.js";
import { formatTerminal } from "../audit/formatters/terminal-formatter.js";
import { formatJson } from "../audit/formatters/json-formatter.js";
import { formatSarif } from "../audit/formatters/sarif-formatter.js";
import { formatReport } from "../audit/formatters/report-formatter.js";
import { yellow } from "../utils/output.js";

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

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
  if (opts.severity) {
    if (!VALID_SEVERITIES.includes(opts.severity as Severity)) {
      console.error(`Invalid severity: ${opts.severity}. Valid: ${VALID_SEVERITIES.join(", ")}`);
      process.exit(1);
      return;
    }
    config.severityThreshold = opts.severity as Severity;
  }
  if (opts.maxFiles) {
    const n = parseInt(opts.maxFiles, 10);
    if (Number.isNaN(n) || n <= 0) {
      console.error(`Invalid --max-files value: ${opts.maxFiles}. Must be a positive integer.`);
      process.exit(1);
      return;
    }
    config.maxFiles = n;
  }

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

  // Filter findings by severity threshold
  const severityOrder = VALID_SEVERITIES;
  const thresholdIndex = severityOrder.indexOf(config.severityThreshold);
  result.findings = result.findings.filter(
    (f) => severityOrder.indexOf(f.severity as Severity) <= thresholdIndex,
  );

  // Output based on format flag
  if (opts.json) {
    console.log(formatJson(result));
  } else if (opts.ci) {
    console.log(formatSarif(result));
  } else {
    console.log(formatTerminal(result));
  }

  // Write markdown report if requested
  if (opts.report) {
    writeFileSync(opts.report, formatReport(result));
  }

  // Exit code: 0=PASS, 1=CONCERNS, 2=FAIL
  if (result.summary.verdict === "FAIL") process.exit(2);
  else if (result.summary.verdict === "CONCERNS") process.exit(1);
  else process.exit(0);
}
