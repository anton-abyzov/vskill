// ---------------------------------------------------------------------------
// vskill disable <name> -- remove the enabledPlugins[<name>@<marketplace>]
// entry without deleting on-disk skill files. Wraps `claude plugin uninstall`
// per ADR 0724-01.
// ---------------------------------------------------------------------------

import { readLockfile } from "../lockfile/index.js";
import { isPluginEnabled } from "../settings/index.js";
import { claudePluginUninstall } from "../utils/claude-plugin.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { resolveCliBinary } from "../utils/resolve-binary.js";
import {
  buildPerAgentReport,
  resolvePluginId,
  type LifecycleAction,
} from "../lib/skill-lifecycle.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";

export interface DisableOptions {
  /** Settings scope. Defaults to "user" — matches `claude plugin uninstall` default. */
  scope?: "user" | "project";
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
}

interface CommandJsonOutput {
  skill: string;
  scope: "user" | "project";
  pluginId: string | null;
  status: "disabled" | "already-disabled" | "auto-discovered" | "dry-run" | "error";
  perAgent: Array<{
    id: string;
    displayName: string;
    surface: "claude-code-style" | "auto-discover";
    action: LifecycleAction;
  }>;
}

export async function disableCommand(
  skillName: string,
  opts: DisableOptions,
): Promise<void> {
  const scope: "user" | "project" = opts.scope ?? "user";

  // ----- 1. Validate skill is in lockfile --------------------------------
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

  // ----- 2. Resolve plugin id (AC-US3-04) --------------------------------
  const pluginId = resolvePluginId(skillName, entry);
  const agents = await detectInstalledAgents();

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
          `${bold(skillName)} is auto-discovered — no plugin entry to disable. To stop loading, run ${cyan("vskill remove " + skillName)}.`,
        ),
      );
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 3. Idempotency check (AC-US3-03) --------------------------------
  const cwd = process.cwd();
  const targetSettingsOpts =
    scope === "project" ? { scope, projectDir: cwd } : { scope: "user" as const };
  const enabledAtTarget = isPluginEnabled(pluginId, targetSettingsOpts);

  if (!enabledAtTarget) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "already-disabled",
      agents,
    });
    emitOk(opts, {
      skill: skillName,
      scope,
      pluginId,
      status: "already-disabled",
      perAgent: report.map(({ line: _line, ...rest }) => rest),
    });
    if (!opts.json) {
      console.log(
        yellow(`${bold(skillName)} already disabled in ${scope} scope.`),
      );
      for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    }
    return;
  }

  // ----- 4. Dry-run preview ---------------------------------------------
  if (opts.dryRun) {
    const report = buildPerAgentReport({
      skill: skillName,
      scope,
      action: "disabled",
      agents,
    });
    const claudeBin = safeResolve("claude");
    const argv = `claude plugin uninstall --scope ${scope} -- ${pluginId}`;
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

  // ----- 5. Actually disable via claude CLI ------------------------------
  try {
    if (opts.verbose) {
      const claudeBin = safeResolve("claude");
      console.log(
        dim(
          `claude binary: ${claudeBin ?? "<not found>"} | scope: ${scope}${scope === "project" ? ` | cwd: ${cwd}` : ""}`,
        ),
      );
    }
    claudePluginUninstall(
      pluginId,
      scope,
      scope === "project" ? { cwd } : undefined,
    );
  } catch (err) {
    const msg = `Failed to disable ${skillName} (${pluginId}) in ${scope} scope: ${(err as Error).message}`;
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, skill: skillName, scope, pluginId }));
    } else {
      console.error(red(msg));
    }
    process.exit(1);
    return;
  }

  // ----- 6. AC-US3-05: hint about other-scope state ---------------------
  const otherScope: "user" | "project" = scope === "user" ? "project" : "user";
  const otherSettingsOpts =
    otherScope === "project"
      ? { scope: otherScope, projectDir: cwd }
      : { scope: "user" as const };
  let stillEnabledOther = false;
  try {
    stillEnabledOther = isPluginEnabled(pluginId, otherSettingsOpts);
  } catch {
    // non-fatal — don't break the success path on a settings.json read error
  }

  // ----- 7. Per-agent report --------------------------------------------
  const report = buildPerAgentReport({
    skill: skillName,
    scope,
    action: "disabled",
    agents,
  });
  emitOk(opts, {
    skill: skillName,
    scope,
    pluginId,
    status: "disabled",
    perAgent: report.map(({ line: _line, ...rest }) => rest),
  });
  if (!opts.json) {
    console.log(
      green(`Disabled ${bold(skillName)} (${pluginId}) in ${scope} scope.`),
    );
    for (const r of report) console.log(`  ${dim(">")} ${r.line}`);
    if (stillEnabledOther) {
      console.log(
        yellow(
          `Hint: still enabled in ${otherScope} scope. Run vskill disable ${skillName} --scope ${otherScope} to fully disable.`,
        ),
      );
    }
  }
}

function emitOk(opts: DisableOptions, payload: CommandJsonOutput): void {
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
