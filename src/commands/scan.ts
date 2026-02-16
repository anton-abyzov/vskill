// ---------------------------------------------------------------------------
// vskill scan -- run tier1 security scan on a SKILL.md
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { runTier1Scan } from "../scanner/index.js";
import type { ScanFinding } from "../scanner/index.js";
import { bold, green, red, yellow, dim, cyan, table } from "../utils/output.js";

export async function scanCommand(path: string): Promise<void> {
  const resolved = resolve(path);

  const filePath = resolveSkillPath(resolved);

  if (!filePath) {
    process.exit(2);
  }

  const content = readFileSync(filePath, "utf-8");
  console.log(bold(`Scanning ${dim(filePath)}\n`));

  const result = runTier1Scan(content);

  // Print verdict
  const verdictColor =
    result.verdict === "PASS"
      ? green
      : result.verdict === "CONCERNS"
        ? yellow
        : red;

  console.log(
    `${bold("Score:")} ${verdictColor(String(result.score))}/100  ` +
      `${bold("Verdict:")} ${verdictColor(result.verdict)}  ` +
      `${bold("Patterns:")} ${result.patternsChecked}  ` +
      `${bold("Time:")} ${result.durationMs}ms\n`
  );

  // Print findings summary
  if (result.findings.length === 0) {
    console.log(green("No security issues found.\n"));
  } else {
    const summary = [
      result.criticalCount > 0
        ? red(`${result.criticalCount} critical`)
        : null,
      result.highCount > 0
        ? yellow(`${result.highCount} high`)
        : null,
      result.mediumCount > 0
        ? cyan(`${result.mediumCount} medium`)
        : null,
      result.lowCount > 0
        ? dim(`${result.lowCount} low`)
        : null,
      result.infoCount > 0
        ? dim(`${result.infoCount} info`)
        : null,
    ]
      .filter(Boolean)
      .join("  ");

    console.log(`${bold("Findings:")} ${summary}\n`);

    // Print detailed findings
    printFindings(result.findings);
  }

  // Exit code
  if (result.verdict === "FAIL") process.exit(2);
  if (result.verdict === "CONCERNS") process.exit(1);
  process.exit(0);
}

function resolveSkillPath(resolved: string): string | null {
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    const candidate = join(resolved, "SKILL.md");
    if (existsSync(candidate)) {
      return candidate;
    }
    console.error(red(`No SKILL.md found in ${resolved}`));
    return null;
  }
  if (existsSync(resolved)) {
    return resolved;
  }
  console.error(red(`File not found: ${resolved}`));
  return null;
}

function printFindings(findings: ScanFinding[]): void {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  const headers = ["Severity", "Pattern", "Category", "Line", "Match"];
  const rows = sorted.map((f) => {
    const sevColor =
      f.severity === "critical"
        ? red
        : f.severity === "high"
          ? yellow
          : f.severity === "medium"
            ? cyan
            : dim;
    return [
      sevColor(f.severity.toUpperCase()),
      f.patternName,
      dim(f.category),
      String(f.lineNumber),
      dim(f.match.substring(0, 40)),
    ];
  });

  console.log(table(headers, rows));
}
