// ---------------------------------------------------------------------------
// commands/check.ts — preflight verification for multi-file skills (0815).
//
// Reads a skill's SKILL.md frontmatter and verifies that every declared
// dependency is satisfied before the skill runs:
//   - mcpDeps[]      → present in ~/.claude/mcp.json or project .claude/mcp.json
//   - secrets[]      → resolvable via env or .env.local (resolveCredential)
//   - runtime.python → `python3 --version` ≥ declared minimum
//   - runtime.pip    → declared (informational; we don't auto-install)
//   - integrationTests.runner === "pytest" → `pytest --collect-only` succeeds
//
// Exit codes:
//   0 → all green
//   1 → at least one required dep missing / unsatisfiable
//   2 → only soft warnings (e.g. unknown MCP, no integration test runner)
//
// Reuses the existing infra: parseSkillFrontmatter + buildSkillMetadata from
// api-routes.ts (so the same wire format the studio writes is the same one we
// validate), plus resolveAllCredentials from credential-resolver.ts.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildSkillMetadata } from "../eval-server/api-routes.js";
import { resolveAllCredentials } from "../eval/credential-resolver.js";

export interface CheckOptions {
  json?: boolean;
  /** Override skill search root (default: cwd). */
  root?: string;
}

interface CheckRow {
  status: "ok" | "missing" | "warning";
  message: string;
}

interface CheckReport {
  skill: string;
  dir: string;
  mcps: Array<{ name: string } & CheckRow>;
  secrets: Array<{ name: string } & CheckRow>;
  runtime: Array<{ key: string } & CheckRow>;
  tests: CheckRow | null;
  exitCode: 0 | 1 | 2;
}

/**
 * Locate a skill directory by name, searching common layouts inside `root`:
 *   - {root}/plugins/<plugin>/skills/<name>/
 *   - {root}/skills/<name>/
 *   - {root}/<name>/                       (flat layout)
 * Returns the first matching absolute path with a SKILL.md, or null.
 */
export function findSkillDir(name: string, root: string): string | null {
  const candidates: string[] = [];
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    try {
      for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        const skillsDir = join(pluginsDir, plugin.name, "skills");
        if (!existsSync(skillsDir)) continue;
        candidates.push(join(skillsDir, name));
      }
    } catch { /* ignore */ }
  }
  candidates.push(join(root, "skills", name));
  candidates.push(join(root, name));
  for (const c of candidates) {
    try {
      if (existsSync(join(c, "SKILL.md")) && statSync(c).isDirectory()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Check whether a named MCP server is configured in any known Claude config
 * file. Returns "configured" if found, "missing" otherwise. Tolerant of
 * malformed JSON — a parse error is treated as "not configured here".
 */
export function checkMcpConfigured(serverName: string, projectRoot: string): "configured" | "missing" {
  const candidates = [
    join(projectRoot, ".claude", "mcp.json"),
    join(homedir(), ".claude", "mcp.json"),
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      const servers = cfg.mcpServers;
      if (servers && typeof servers === "object" && serverName in (servers as Record<string, unknown>)) {
        return "configured";
      }
    } catch { /* ignore parse error */ }
  }
  return "missing";
}

/**
 * Compare a `python3 --version` output line ("Python 3.11.4") against a
 * declared minimum in the form ">=3.10" or "3.10" (treated as exact-major+).
 * Returns true if the runtime satisfies the declaration, false otherwise.
 */
export function pythonVersionSatisfies(installed: string, declared: string): boolean {
  const m = installed.match(/Python\s+(\d+)\.(\d+)/);
  if (!m) return false;
  const haveMaj = parseInt(m[1], 10);
  const haveMin = parseInt(m[2], 10);
  const decl = declared.replace(/^[><=~^]+/, "").trim();
  const dm = decl.match(/^(\d+)\.(\d+)/);
  if (!dm) return false;
  const wantMaj = parseInt(dm[1], 10);
  const wantMin = parseInt(dm[2], 10);
  if (haveMaj !== wantMaj) return haveMaj > wantMaj;
  return haveMin >= wantMin;
}

/**
 * Build the structured CheckReport for a skill. Pure, testable — no console
 * I/O. The CLI wrapper (`checkCommand`) renders this report to stdout.
 */
export function buildCheckReport(skillName: string, projectRoot: string): CheckReport {
  const dir = findSkillDir(skillName, projectRoot);
  if (!dir) {
    return {
      skill: skillName,
      dir: "",
      mcps: [],
      secrets: [],
      runtime: [],
      tests: null,
      exitCode: 1,
    };
  }
  const meta = buildSkillMetadata(dir, "source", projectRoot);

  const mcps = (meta.mcpDeps ?? []).map((name) => {
    const status = checkMcpConfigured(name, projectRoot);
    return {
      name,
      status: status === "configured" ? ("ok" as const) : ("missing" as const),
      message: status === "configured" ? "configured" : "not configured in any known Claude config",
    };
  });

  const secretStatuses = resolveAllCredentials(meta.secrets ?? [], dir);
  const secrets = secretStatuses.map((s) => ({
    name: s.name,
    status: s.status === "ready" ? ("ok" as const) : ("missing" as const),
    message: s.status === "ready" ? `ready (${s.source})` : "missing — set in env or .env.local",
  }));

  const runtime: Array<{ key: string } & CheckRow> = [];
  if (meta.runtime?.python) {
    const result = spawnSync("python3", ["--version"], { encoding: "utf-8" });
    if (result.status === 0) {
      const out = (result.stdout || result.stderr || "").trim();
      const ok = pythonVersionSatisfies(out, meta.runtime.python);
      runtime.push({
        key: "python",
        status: ok ? "ok" : "missing",
        message: ok ? `${out} satisfies ${meta.runtime.python}` : `${out} does not satisfy ${meta.runtime.python}`,
      });
    } else {
      runtime.push({
        key: "python",
        status: "missing",
        message: `python3 not on PATH (declared ${meta.runtime.python})`,
      });
    }
  }
  if (meta.runtime?.pip && meta.runtime.pip.length > 0) {
    runtime.push({
      key: "pip",
      status: "warning",
      message: `declares ${meta.runtime.pip.length} pip package(s) — install manually before running`,
    });
  }

  let tests: CheckRow | null = null;
  if (meta.integrationTests?.runner === "pytest") {
    const file = meta.integrationTests.file
      ? resolve(dir, meta.integrationTests.file)
      : resolve(dir, "tests");
    if (!existsSync(file)) {
      tests = { status: "missing", message: `pytest target ${meta.integrationTests.file ?? "tests/"} not found` };
    } else {
      const result = spawnSync("python3", ["-m", "pytest", "--collect-only", file], {
        encoding: "utf-8",
        cwd: dir,
      });
      if (result.status === 0) {
        tests = { status: "ok", message: "pytest --collect-only succeeded" };
      } else {
        tests = {
          status: "missing",
          message: `pytest --collect-only failed (exit ${result.status ?? "?"}): ${(result.stderr || "").split("\n")[0] || "no stderr"}`,
        };
      }
    }
  } else if (meta.integrationTests?.runner === "vitest") {
    tests = { status: "warning", message: "vitest collection check not yet implemented" };
  } else if (meta.integrationTests?.runner === "none") {
    tests = { status: "ok", message: "no integration tests declared" };
  }

  // Compute exit code: 0 all green, 1 any missing, 2 only warnings.
  let anyMissing = false;
  let anyWarning = false;
  for (const row of [...mcps, ...secrets, ...runtime, ...(tests ? [tests] : [])]) {
    if (row.status === "missing") anyMissing = true;
    if (row.status === "warning") anyWarning = true;
  }
  const exitCode: 0 | 1 | 2 = anyMissing ? 1 : anyWarning ? 2 : 0;

  return { skill: skillName, dir, mcps, secrets, runtime, tests, exitCode };
}

/**
 * CLI entry point — prints the report and exits with the appropriate code.
 * Never echoes secret values; only names + statuses.
 */
export async function checkCommand(skillName: string, opts: CheckOptions = {}): Promise<void> {
  const root = opts.root ? resolve(opts.root) : process.cwd();
  const report = buildCheckReport(skillName, root);

  if (!report.dir) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ...report, error: "skill-not-found" }, null, 2) + "\n");
    } else {
      process.stderr.write(`vskill check: skill '${skillName}' not found under ${root}\n`);
    }
    process.exit(1);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exit(report.exitCode);
  }

  // Human-readable rendering — never includes secret values.
  const lines: string[] = [];
  lines.push(`vskill check: ${report.skill}`);
  lines.push(`  ${report.dir}`);
  lines.push("");
  if (report.mcps.length === 0) {
    lines.push("MCPs:    (none declared)");
  } else {
    lines.push("MCPs:");
    for (const r of report.mcps) lines.push(`  ${glyph(r.status)} ${r.name}: ${r.message}`);
  }
  if (report.secrets.length === 0) {
    lines.push("Secrets: (none declared)");
  } else {
    lines.push("Secrets:");
    for (const r of report.secrets) lines.push(`  ${glyph(r.status)} ${r.name}: ${r.message}`);
  }
  if (report.runtime.length === 0) {
    lines.push("Runtime: (none declared)");
  } else {
    lines.push("Runtime:");
    for (const r of report.runtime) lines.push(`  ${glyph(r.status)} ${r.key}: ${r.message}`);
  }
  if (report.tests) {
    lines.push(`Tests:   ${glyph(report.tests.status)} ${report.tests.message}`);
  } else {
    lines.push("Tests:   (no integration runner declared)");
  }
  lines.push("");
  lines.push(
    report.exitCode === 0
      ? "All checks passed."
      : report.exitCode === 2
        ? "Soft warnings only — review above."
        : "One or more required dependencies missing — see above.",
  );

  process.stdout.write(lines.join("\n") + "\n");
  process.exit(report.exitCode);
}

function glyph(status: "ok" | "missing" | "warning"): string {
  switch (status) {
    case "ok": return "[OK]    ";
    case "missing": return "[MISS]  ";
    case "warning": return "[WARN]  ";
  }
}
