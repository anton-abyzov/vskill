// ---------------------------------------------------------------------------
// 0793 — `vskill plugin <subcommand>` family.
//
// Today: `new <name>` scaffolds a Claude Code plugin (`.claude-plugin/plugin.json`)
// with optional first skill (`--with-skill <slug>`). We delegate schema
// validation to `claude plugin validate <path>` so vskill never duplicates
// Claude Code's plugin schema. When `claude` is not on PATH, validation
// soft-skips with a warning so vskill stays usable in CI.
//
// This command exists because Claude Code's `claude plugin` CLI has no
// `new`/`create`/`init` subcommand — plugin authoring is otherwise unowned.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Command } from "commander";

import {
  pluginJsonScaffold,
  skillMdScaffold,
  validateKebabName,
} from "../eval-server/authoring-routes.js";
import { validateClaudePlugin } from "../core/plugin-validator.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";

interface PluginNewOpts {
  description?: string;
  withSkill?: string;
  cwd?: string;
}

function exit(code: number): never {
  process.exit(code);
  // satisfies TS in tests where exit is spied
  throw new Error("process.exit did not terminate");
}

export async function pluginNewCommand(
  pluginName: string,
  opts: PluginNewOpts,
): Promise<void> {
  const nameErr = validateKebabName(pluginName, "plugin name");
  if (nameErr) {
    console.error(red("Error: ") + dim(nameErr));
    exit(1);
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const pluginDir = join(cwd, pluginName);
  const manifestDir = join(pluginDir, ".claude-plugin");
  const manifestPath = join(manifestDir, "plugin.json");

  if (existsSync(manifestPath)) {
    console.error(
      red("Error: ") +
        dim(`plugin manifest already exists: ${manifestPath}`),
    );
    console.error(
      dim("  Pick a different name or delete the existing manifest first."),
    );
    exit(1);
  }

  let withSkill: string | null = null;
  if (opts.withSkill !== undefined) {
    const skillErr = validateKebabName(opts.withSkill, "--with-skill");
    if (skillErr) {
      console.error(red("Error: ") + dim(skillErr));
      exit(1);
    }
    withSkill = opts.withSkill;
    const skillDir = join(pluginDir, "skills", withSkill);
    if (existsSync(skillDir)) {
      console.error(
        red("Error: ") +
          dim(`skill directory already exists: ${skillDir}`),
      );
      exit(1);
    }
  }

  const description = (opts.description ?? "").trim() || `Plugin: ${pluginName}`;

  // All-or-nothing scaffolding: track what we create so we can roll the whole
  // tree back on validator failure. If we wrote both a manifest AND a first
  // skill, leaving the skill behind on rollback creates a phantom skill that
  // would surprise the user (they ran one command, saw an error, and now the
  // workspace has files they didn't ask for).
  const created: { skillDir?: string } = {};
  try {
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(manifestPath, pluginJsonScaffold(pluginName, description), "utf8");

    if (withSkill) {
      const skillDir = join(pluginDir, "skills", withSkill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        skillMdScaffold(withSkill, description),
        "utf8",
      );
      created.skillDir = skillDir;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red("Error: ") + dim(`failed to write plugin files: ${message}`));
    exit(1);
  }

  // Schema validation via `claude plugin validate` — single source of truth
  // for the plugin schema.
  const validation = validateClaudePlugin(pluginDir);
  if (!validation.ok) {
    // Roll back EVERYTHING this command created. The manifest first (cheap),
    // then the skill folder if we wrote one. After the artifact removals,
    // best-effort `rmdirSync` walks up the tree (skills/ → pluginDir/) and
    // removes each level only if it became empty — so we never delete user
    // files that were already there.
    try {
      unlinkSync(manifestPath);
      rmSync(manifestDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    if (created.skillDir) {
      try {
        rmSync(created.skillDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      // rmdirSync only removes empty dirs (vs rmSync without `recursive`,
      // which throws ENOTEMPTY on non-empty AND on empty dirs in some Node
      // versions). Wrapping in try/catch lets us safely walk up.
      try {
        rmdirSync(join(pluginDir, "skills"));
      } catch {
        /* skills/ has other content the user owns — leave it */
      }
    }
    try {
      rmdirSync(pluginDir);
    } catch {
      /* pluginDir not empty (other files we didn't create) — leave it */
    }
    console.error(red("Error: ") + dim("claude plugin validate rejected the generated manifest:"));
    console.error(validation.stderr || "(no stderr captured)");
    console.error(
      dim("  The plugin scaffold has been rolled back. Please file an issue if this is unexpected."),
    );
    exit(1);
  }

  if (validation.skipped) {
    console.warn(
      yellow("Warning: ") +
        dim("`claude` CLI not found on PATH; plugin schema was NOT validated."),
    );
    console.warn(
      dim("  Install Claude Code (https://claude.com/claude-code) to enable validation."),
    );
  }

  // Success summary
  console.log(green("✔ Plugin scaffolded"));
  console.log(dim("  manifest: ") + manifestPath);
  if (withSkill) {
    console.log(
      dim("  skill:    ") + join(pluginDir, "skills", withSkill, "SKILL.md"),
    );
  }
  console.log("");
  console.log(bold("Next steps:"));
  console.log("  " + cyan(`cd ${pluginName}`));
  if (!withSkill) {
    console.log(
      "  " +
        cyan(`vskill skill new --prompt "..."`) +
        dim("  # add your first skill"),
    );
  }
  console.log("  " + cyan(`vskill studio`) + dim("  # open in Skill Studio"));
}

export function registerPluginCommand(program: Command): void {
  const plugin = program
    .command("plugin")
    .description(
      "Plugin authoring: scaffold a Claude Code plugin (.claude-plugin/plugin.json + skills/)",
    );

  plugin
    .command("new <name>")
    .description("Scaffold a new plugin folder with manifest and (optional) first skill")
    .option("--description <text>", "Description written into plugin.json")
    .option(
      "--with-skill <slug>",
      "Also scaffold <name>/skills/<slug>/SKILL.md as the first skill",
    )
    .option("--cwd <path>", "Create the plugin under this directory (default: process.cwd())")
    .action(async (name: string, opts: PluginNewOpts) => {
      await pluginNewCommand(name, opts);
    });
}
