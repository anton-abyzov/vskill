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
  .command("install <source>")
  .alias("i")
  .alias("add")
  .description("Install a skill from GitHub after security scan")
  .option("--skill <name>", "Skill name within a multi-skill repo")
  .option("--plugin <name>", "Plugin name from marketplace.json")
  .option("--plugin-dir <path>", "Local plugin directory path")
  .option("--repo <owner/repo>", "GitHub repo with marketplace.json (use with --plugin)")
  .option("--global", "Install to global agent directories")
  .option("--force", "Install even if scan finds issues")
  .option("--agent <id>", "Install to specific agent only (repeatable)", collect, [])
  .option("--cwd", "Install relative to current directory instead of project root")
  .option("--copy", "Install as independent copies instead of symlinks (default: symlink)")
  .option("--select", "Interactively select skills and agents (default: install all)")
  .option("-y, --yes", "Skip all prompts, use defaults (all skills, all agents, project scope, symlink)")
  .action(async (source: string, opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(source, opts);
  });

program
  .command("init")
  .description("Show detected AI agents and update lockfile (optional)")
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
  .action(async (query: string) => {
    const { findCommand } = await import("./commands/find.js");
    await findCommand(query);
  });

program
  .command("update [skill]")
  .description("Update installed skills from the registry")
  .option("--all", "Update all installed skills")
  .action(async (skill: string | undefined, opts) => {
    const { updateCommand } = await import("./commands/update.js");
    await updateCommand(skill, opts);
  });

program
  .command("submit <source>")
  .description("Submit a skill for verification on verified-skill.com")
  .option("--skill <name>", "Skill name within a multi-skill repo")
  .action(async (source: string, opts) => {
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

program.parse();
