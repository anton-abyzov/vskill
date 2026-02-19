// ---------------------------------------------------------------------------
// vskill remove -- remove an installed skill from all agents
// ---------------------------------------------------------------------------

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveTilde } from "../utils/paths.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { readLockfile, removeSkillFromLock } from "../lockfile/index.js";
import { bold, green, red, yellow, dim } from "../utils/output.js";

interface RemoveOptions {
  global?: boolean;
  local?: boolean;
  force?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function removeCommand(
  skillName: string,
  opts: RemoveOptions,
): Promise<void> {
  // Read lockfile to check if skill exists
  const lock = readLockfile();
  const skillEntry = lock?.skills[skillName];

  if (!skillEntry && !opts.force) {
    console.error(
      red(`Skill "${skillName}" not found in lockfile.\n`) +
        dim("Use --force to attempt removal anyway."),
    );
    process.exit(1);
  }

  // Confirmation prompt
  if (!opts.force) {
    const yes = await confirm(
      `Remove skill ${bold(skillName)} from all agents?`,
    );
    if (!yes) {
      console.log(dim("Cancelled."));
      return;
    }
  }

  // Detect installed agents
  const agents = await detectInstalledAgents();
  let removedCount = 0;
  const removedFrom: string[] = [];

  for (const agent of agents) {
    const paths: Array<{ label: string; dir: string }> = [];

    if (!opts.global) {
      // Local dirs
      paths.push({
        label: `${agent.displayName} (local)`,
        dir: join(process.cwd(), agent.localSkillsDir, skillName),
      });
    }

    if (!opts.local) {
      // Global dirs
      paths.push({
        label: `${agent.displayName} (global)`,
        dir: resolveTilde(join(agent.globalSkillsDir, skillName)),
      });
    }

    for (const { label, dir } of paths) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
          removedFrom.push(label);
          removedCount++;
        } catch (err) {
          console.error(
            yellow(`Failed to remove from ${label}: `) +
              dim((err as Error).message),
          );
        }
      }
    }
  }

  // Update lockfile
  if (skillEntry) {
    removeSkillFromLock(skillName);
  }

  // Summary
  if (removedCount > 0) {
    console.log(
      green(`\nRemoved ${bold(skillName)} from ${removedCount} location${removedCount === 1 ? "" : "s"}:\n`),
    );
    for (const loc of removedFrom) {
      console.log(`  ${dim(">")} ${loc}`);
    }
  } else {
    console.log(dim(`\nNo installed files found for "${skillName}".`));
  }

  if (skillEntry) {
    console.log(dim("\nLockfile updated."));
  }
}
