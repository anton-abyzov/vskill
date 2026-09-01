// ---------------------------------------------------------------------------
// commands/check.ts — preflight verification for multi-file skills (0815).
//
// Reads a skill's SKILL.md frontmatter and verifies that every declared
// dependency is satisfied before the skill runs:
//   - mcpDeps[]      → present in any known Claude config: project .mcp.json /
//                      .claude/mcp.json, ~/.claude/mcp.json, Claude Desktop, or
//                      ~/.claude.json (both top-level mcpServers and the
//                      per-project projects[<dir>].mcpServers map)
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

/** Where an MCP server declaration was found. */
export type McpScope =
  /** A project-level config file (.mcp.json or .claude/mcp.json) in the project root. */
  | "project-file"
  /** Top-level mcpServers in a user-wide config. */
  | "user-global"
  /** ~/.claude.json → projects[<dir>].mcpServers — Claude Code's per-project store. */
  | "project-scoped"
  /** Claude Desktop's claude_desktop_config.json. */
  | "desktop";

export interface McpLocation {
  status: "configured" | "missing";
  scope?: McpScope;
  /** Config file the declaration was read from. */
  source?: string;
  /** For "project-scoped": the project directory the server is registered under. */
  projectPath?: string;
  /** True when a project-scoped hit belongs to a DIFFERENT project than the one checked. */
  otherProject?: boolean;
}

function hasServer(container: unknown, serverName: string): boolean {
  return (
    !!container &&
    typeof container === "object" &&
    serverName in (container as Record<string, unknown>)
  );
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null; // malformed config is treated as "not configured here"
  }
}

/**
 * Locate a named MCP server across every known Claude config layout, reporting
 * WHERE it was found.
 *
 * Claude Code stores servers in three different shapes, and a skill can legally
 * depend on any of them:
 *   - <projectRoot>/.mcp.json            → checked-in project servers
 *   - <projectRoot>/.claude/mcp.json     → local project servers
 *   - ~/.claude.json  mcpServers         → user-global servers
 *   - ~/.claude.json  projects[<dir>].mcpServers → per-project servers (the common case
 *                                          for anything added with `claude mcp add`)
 *   - ~/.claude/mcp.json                 → user-global servers
 *   - Claude Desktop's claude_desktop_config.json
 *
 * `homeDir` is injectable so tests can exercise the user-level layouts without
 * touching the real home directory.
 */
export function locateMcpServer(
  serverName: string,
  projectRoot: string,
  homeDir: string = homedir(),
): McpLocation {
  const fileCandidates: Array<{ path: string; scope: McpScope }> = [
    { path: join(projectRoot, ".mcp.json"), scope: "project-file" },
    { path: join(projectRoot, ".claude", "mcp.json"), scope: "project-file" },
    { path: join(homeDir, ".claude", "mcp.json"), scope: "user-global" },
    {
      path: join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      scope: "desktop",
    },
  ];

  for (const { path, scope } of fileCandidates) {
    const cfg = readJson(path);
    if (cfg && hasServer(cfg.mcpServers, serverName)) {
      return { status: "configured", scope, source: path };
    }
  }

  // ~/.claude.json carries BOTH a global map and a per-project map.
  const claudeJsonPath = join(homeDir, ".claude.json");
  const claudeJson = readJson(claudeJsonPath);
  if (claudeJson) {
    if (hasServer(claudeJson.mcpServers, serverName)) {
      return { status: "configured", scope: "user-global", source: claudeJsonPath };
    }
    const projects = claudeJson.projects;
    if (projects && typeof projects === "object") {
      const entries = Object.entries(projects as Record<string, unknown>);
      // Prefer the project being checked; fall back to any other project so the
      // user is told the server exists but is scoped elsewhere.
      const resolvedRoot = resolve(projectRoot);
      let fallback: McpLocation | null = null;
      for (const [dir, value] of entries) {
        if (!value || typeof value !== "object") continue;
        if (!hasServer((value as Record<string, unknown>).mcpServers, serverName)) continue;
        const hit: McpLocation = {
          status: "configured",
          scope: "project-scoped",
          source: claudeJsonPath,
          projectPath: dir,
        };
        if (resolve(dir) === resolvedRoot) return hit;
        fallback ??= { ...hit, otherProject: true };
      }
      if (fallback) return fallback;
    }
  }

  return { status: "missing" };
}

/**
 * Back-compatible wrapper: "configured" if the server is registered anywhere,
 * "missing" otherwise. Prefer `locateMcpServer` when the scope matters.
 */
export function checkMcpConfigured(
  serverName: string,
  projectRoot: string,
  homeDir: string = homedir(),
): "configured" | "missing" {
  return locateMcpServer(serverName, projectRoot, homeDir).status;
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
    const found = locateMcpServer(name, projectRoot);
    if (found.status === "missing") {
      return {
        name,
        status: "missing" as const,
        message: "not configured in any known Claude config",
      };
    }
    if (found.scope === "project-scoped") {
      return found.otherProject
        ? {
            name,
            status: "warning" as const,
            message: `configured, but project-scoped to ${found.projectPath} — not this project`,
          }
        : {
            name,
            status: "ok" as const,
            message: `configured (project-scoped: ${found.projectPath})`,
          };
    }
    const where =
      found.scope === "user-global" ? "user global"
      : found.scope === "desktop" ? "Claude Desktop"
      : found.source ?? "project";
    return { name, status: "ok" as const, message: `configured (${where})` };
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
