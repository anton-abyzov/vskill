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
  .description("Install a skill from GitHub with security scanning")
  .option("--skill <name>", "Skill name within a multi-skill repo")
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
  .option("--email <email>", "Email for submission updates")
  .action(async (source: string, opts) => {
    const { submitCommand } = await import("./commands/submit.js");
    await submitCommand(source, opts);
  });

program.parse();
