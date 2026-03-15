#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("vskill")
  .description("Secure multi-platform AI skill installer -- scan before you install")
  .version(pkg.version, "-v, --version");

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

program
  .command("install [source]")
  .alias("i")
  .description("Install a skill from GitHub after security scan")
  .option("--skill <name>", "Skill name within a multi-skill repo")
  .option("--plugin <name>", "Plugin name from marketplace.json")
  .option("--plugin-dir <path>", "Local plugin directory path")
  .option("--repo <owner/repo>", "GitHub repo with marketplace.json (use with --plugin)")
  .option("--all", "Install all plugins from --repo marketplace")
  .option("--global", "Install to global agent directories")
  .option("--force", "Install even if scan finds issues")
  .option("--agent <id>", "Install to specific agent only (repeatable)", collect, [])
  .option("--cwd", "Install relative to current directory instead of project root")
  .option("--copy", "Install as independent copies instead of symlinks (default: symlink)")
  .option("--select", "Interactively select skills and agents (default: install all)")
  .option("--only-skills <names>", "Only install specific skills from a plugin (comma-separated)")
  .option("-y, --yes", "Skip all prompts, use defaults (all skills, all agents, project scope, symlink)")
  .action(async (source: string | undefined, opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(source, opts);
  });

program
  .command("init")
  .description("Detect installed AI agents and optionally update the lockfile")
  .action(async () => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand();
  });

program
  .command("scan <path>")
  .description("Run tier-1 security scan on a SKILL.md file")
  .action(async (path: string) => {
    const { scanCommand } = await import("./commands/scan.js");
    await scanCommand(path);
  });

program
  .command("list")
  .description("List installed skills or detected agents")
  .option("--agents", "Show all 39 known agents with installed status")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand(opts);
  });

program
  .command("remove <skill-name>")
  .description("Remove an installed skill from all agents")
  .option("--global", "Only remove from global agent directories")
  .option("--local", "Only remove from local agent directories")
  .option("--force", "Skip confirmation and proceed even if not in lockfile")
  .action(async (skillName: string, opts) => {
    const { removeCommand } = await import("./commands/remove.js");
    await removeCommand(skillName, opts);
  });

program
  .command("find <query>")
  .alias("search")
  .description("Search the verified-skill.com registry")
  .option("--limit <n>", "Max results (default 7, up to 30)", parseInt)
  .option("--json", "Output raw JSON")
  .action(async (query: string, opts: { limit?: number; json?: boolean }) => {
    const { findCommand } = await import("./commands/find.js");
    await findCommand(query, { limit: opts.limit, json: opts.json });
  });

program
  .command("update [skill]")
  .description("Update installed skills from the registry")
  .option("--all", "Update all installed skills")
  .option("--agent <id>", "Update only for specific agent (repeatable)", collect, [])
  .action(async (skill: string | undefined, opts) => {
    const { updateCommand } = await import("./commands/update.js");
    await updateCommand(skill, opts);
  });

program
  .command("submit [source]")
  .description("Submit a skill for verification on verified-skill.com")
  .option("--skill <name>", "Skill name within a multi-skill repo")
  .action(async (source: string | undefined, opts) => {
    const { submitCommand } = await import("./commands/submit.js");
    await submitCommand(source, opts);
  });

program
  .command("audit [path]")
  .description("Audit a local project for security vulnerabilities")
  .option("--json", "Output results as JSON")
  .option("--ci", "Output SARIF v2.1.0 for CI integration")
  .option("--report [path]", "Generate markdown report")
  .option("--fix", "Include suggested fixes for each finding")
  .option("--tier1-only", "Skip LLM analysis, use regex patterns only")
  .option("--exclude <patterns>", "Comma-separated exclude patterns")
  .option("--severity <level>", "Minimum severity to report")
  .option("--max-files <n>", "Maximum files to scan (default: 500)")
  .action(async (path: string | undefined, opts) => {
    const { auditCommand } = await import("./commands/audit.js");
    await auditCommand(path || ".", {
      json: opts.json,
      ci: opts.ci,
      report: opts.report,
      fix: opts.fix,
      tier1Only: opts.tier1Only,
      exclude: opts.exclude,
      severity: opts.severity,
      maxFiles: opts.maxFiles,
    });
  });

program
  .command("info <skill-name>")
  .description("Display detailed information about a skill from the registry")
  .action(async (skillName: string) => {
    const { infoCommand } = await import("./commands/info.js");
    await infoCommand(skillName);
  });

program
  .command("blocklist [subcommand] [name]")
  .description("Manage the malicious skills blocklist")
  .action(async (subcommand?: string, name?: string) => {
    const { blocklistCommand } = await import("./commands/blocklist.js");
    await blocklistCommand(subcommand || "list", name);
  });

program
  .command("eval [subcommand] [target]")
  .description("Eval commands: serve, init, run, coverage, generate-all")
  .option("--force", "Overwrite existing evals.json")
  .option("--root <path>", "Root directory to scan for skills (default: current dir)")
  .option("--port <number>", "Port for eval UI server (default: 3077)")
  .action(async (subcommand?: string, target?: string, opts?: any) => {
    const { evalCommand } = await import("./commands/eval.js");
    await evalCommand(subcommand || "coverage", target, opts);
  });

program
  .command("studio")
  .description("Launch the Skill Studio UI for local skill development")
  .option("--root <path>", "Root directory (default: current dir)")
  .option("--port <number>", "Port for Skill Studio server")
  .action(async (opts: { root?: string; port?: string }) => {
    const { resolve } = await import("node:path");
    const { runEvalServe } = await import("./commands/eval/serve.js");
    const root = opts.root ? resolve(opts.root) : resolve(".");
    const port = opts.port ? parseInt(opts.port, 10) : null;
    await runEvalServe(root, port);
  });

program
  .command("marketplace [subcommand]")
  .alias("mp")
  .description("Manage marketplace.json — sync plugins, list entries")
  .option("--dry-run", "Preview changes without writing")
  .option("--cwd <path>", "Root directory containing .claude-plugin/ (default: project root)")
  .action(async (subcommand = "sync", opts) => {
    const { marketplaceCommand } = await import("./commands/marketplace.js");
    await marketplaceCommand(subcommand, opts);
  });

program.parse();
