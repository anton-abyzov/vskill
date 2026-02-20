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

program
  .command("init")
  .description("Initialize vskill and detect installed AI agents")
  .action(async () => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand();
  });

program
  .command("add <source>")
  .description("Install a skill from GitHub or local plugin directory")
  .option("--skill <name>", "Skill name within a multi-skill repo")
  .option("--plugin <name>", "Plugin name from marketplace.json")
  .option("--plugin-dir <path>", "Local plugin directory path")
  .option("--global", "Install to global agent directories")
  .option("--force", "Install even if scan finds issues")
  .action(async (source: string, opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(source, opts);
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
  .command("blocklist [subcommand] [name]")
  .description("Manage the malicious skills blocklist")
  .action(async (subcommand?: string, name?: string) => {
    const { blocklistCommand } = await import("./commands/blocklist.js");
    await blocklistCommand(subcommand || "list", name);
  });

program.parse();
