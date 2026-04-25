// ---------------------------------------------------------------------------
// vskill enable <name> -- flip enabledPlugins[<name>@<marketplace>] back on
// without re-extracting the skill files. Wraps `claude plugin install` per
// ADR 0724-01.
// ---------------------------------------------------------------------------

import { readLockfile } from "../lockfile/index.js";
import { isPluginEnabled } from "../settings/index.js";
import { claudePluginInstall } from "../utils/claude-plugin.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { resolveCliBinary } from "../utils/resolve-binary.js";
import {
  buildPerAgentReport,
  classifyAgentSurface,
  resolvePluginId,
  type LifecycleAction,
} from "../lib/skill-lifecycle.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";

export interface EnableOptions {
  /** Settings scope. Defaults to "user" — matches `claude plugin install` default. */
  scope?: "user" | "project";
  /** Print the would-be invocation without running it. */
  dryRun?: boolean;
  /** Verbose output (resolved paths, claude binary, exit code). */
  verbose?: boolean;
  /** Emit machine-readable JSON instead of human-readable lines. */
  json?: boolean;
}

interface CommandJsonOutput {
  skill: string;
  scope: "user" | "project";
  pluginId: string | null;
  status: "enabled" | "already-enabled" | "auto-discovered" | "dry-run" | "error";
  perAgent: Array<{
    id: string;
    displayName: string;
    surface: "claude-code-style" | "auto-discover";
    action: LifecycleAction;
  }>;
}

export async function enableCommand(
  skillName: string,
  opts: EnableOptions,
): Promise<void> {
  // F-006 fix: Commander accepts any string for --scope <scope> (no built-in
  // choices on action callbacks). Validate at the entry point so a typo like
  // `--scope projet` errors loudly instead of silently routing to user scope.
  if (
    opts.scope !== undefined &&
    opts.scope !== "user" &&
    opts.scope !== "project"
  ) {
    const msg = `Invalid --scope "${opts.scope}". Allowed values: user, project.`;
    if (opts.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(red(msg));
    }
    process.exit(1);
    return;
  }
  const scope: "user" | "project" = opts.scope ?? "user";

  // ----- 1. Validate skill is in lockfile (AC-US2-02) ---------------------
  const lock = readLockfile();
  const entry = lock?.skills[skillName];
  if (!entry) {
    const msg = `Skill "${skillName}" is not installed (no entry in vskill.lock).`;
    const hint = `Run ${cyan("vskill install " + skillName)} first.`;
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, hint }));
    } else {
      console.error(red(msg));
      console.error(dim(hint));
    }
    process.exit(1);
    return;
  }

  // ----- 2. Resolve plugin id (AC-US3-04 mirror) --------------------------
  const pluginId = resolvePluginId(skillName, entry);

  // Detect agents up-front for the per-agent report.
  const agents = await detectInstalledAgents();

  // Auto-discovered skill: nothing to flip in settings.json. Print a no-op
  // line and exit 0. This also covers the "only-non-claude-agents detected"
  // case (AC-US5-03) implicitly — there's nobody to enable for.
  if (pluginId === null) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "not-applicable",
      agents,
    });
    emitOk(opts, {
      skill: skillName,
      scope,
      pluginId: null,
      status: "auto-discovered",
      perAgent: report.map(({ line: _line, ...rest }) => rest),
    });
    if (!opts.json) {
      console.log(
        dim(
          `${bold(skillName)} is auto-discovered by agents from their skills dir — no enable step needed.`,
        ),
      );
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 3. AC-US5-03: when no claude-code-style agent is detected --------
  const hasClaudeStyle = agents.some(
    (a) => classifyAgentSurface(a) === "claude-code-style",
  );
  if (!hasClaudeStyle) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "not-applicable",
      agents,
    });
    emitOk(opts, {
      skill: skillName,
      scope,
      pluginId,
      status: "auto-discovered",
      perAgent: report.map(({ line: _line, ...rest }) => rest),
    });
    if (!opts.json) {
      console.log(
        dim(
          `No agent requires explicit enable — detected agents auto-discover from their skills dir. Skill is already on disk and live.`,
        ),
      );
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 4. Idempotency check (AC-US2-03) --------------------------------
  const cwd = process.cwd();
  const settingsOpts =
    scope === "project" ? { scope, projectDir: cwd } : { scope: "user" as const };
  const already = isPluginEnabled(pluginId, settingsOpts);
  if (already) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "already-enabled",
      agents,
    });
    emitOk(opts, {
      skill: skillName,
      scope,
      pluginId,
      status: "already-enabled",
      perAgent: report.map(({ line: _line, ...rest }) => rest),
    });
    if (!opts.json) {
      console.log(
        yellow(`${bold(skillName)} already enabled in ${scope} scope.`),
      );
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 5. Dry-run preview (AC-US2-05, AC-US6-01) -----------------------
  if (opts.dryRun) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "enabled",
      agents,
    });
    const claudeBin = safeResolve("claude");
    const argv = `claude plugin install --scope ${scope} -- ${pluginId}`;
    emitOk(opts, {
      skill: skillName,
      scope,
      pluginId,
      status: "dry-run",
      perAgent: report.map(({ line: _line, ...rest }) => rest),
    });
    if (!opts.json) {
      console.log(bold(`Dry-run — would execute:`));
      console.log(`  ${cyan(argv)}`);
      if (opts.verbose) {
        console.log(dim(`  binary: ${claudeBin ?? "<claude not found on PATH>"}`));
        console.log(dim(`  scope:  ${scope}`));
        if (scope === "project") console.log(dim(`  cwd:    ${cwd}`));
      }
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 6. Actually enable via claude CLI (AC-US2-01, AC-US2-04) --------
  try {
    if (opts.verbose) {
      const claudeBin = safeResolve("claude");
      console.log(
        dim(
          `claude binary: ${claudeBin ?? "<not found>"} | scope: ${scope}${scope === "project" ? ` | cwd: ${cwd}` : ""}`,
        ),
      );
    }
    claudePluginInstall(
      pluginId,
      scope,
      scope === "project" ? { cwd } : undefined,
    );
  } catch (err) {
    const msg = `Failed to enable ${skillName} (${pluginId}) in ${scope} scope: ${(err as Error).message}`;
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, skill: skillName, scope, pluginId }));
    } else {
      console.error(red(msg));
    }
    process.exit(1);
    return;
  }

  // ----- 7. Per-agent success report -------------------------------------
  const report = buildPerAgentReport({
    skill: skillName,
    scope,
    action: "enabled",
    agents,
  });
  emitOk(opts, {
    skill: skillName,
    scope,
    pluginId,
    status: "enabled",
    perAgent: report.map(({ line: _line, ...rest }) => rest),
  });
  if (!opts.json) {
    console.log(green(`Enabled ${bold(skillName)} (${pluginId}) in ${scope} scope.`));
    for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitOk(opts: EnableOptions, payload: CommandJsonOutput): void {
  if (opts.json) {
    console.log(JSON.stringify(payload));
  }
}

function safeResolve(name: string): string | null {
  try {
    return resolveCliBinary(name);
  } catch {
    return null;
  }
}
