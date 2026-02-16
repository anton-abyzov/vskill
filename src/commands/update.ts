// ---------------------------------------------------------------------------
// vskill update -- update installed skills
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readLockfile, writeLockfile } from "../lockfile/index.js";
import { getSkill } from "../api/client.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { runTier1Scan } from "../scanner/index.js";
import {
  bold,
  green,
  red,
  yellow,
  dim,
  cyan,
  spinner,
} from "../utils/output.js";

interface UpdateOptions {
  all?: boolean;
}

export async function updateCommand(
  skill: string | undefined,
  opts: UpdateOptions
): Promise<void> {
  const lock = readLockfile();
  if (!lock) {
    console.error(
      yellow("No vskill.lock found. Run ") +
        cyan("vskill init") +
        yellow(" first.")
    );
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  const skillNames = Object.keys(lock.skills);
  if (skillNames.length === 0) {
    console.log(dim("No skills installed. Nothing to update."));
    return;
  }

  // Determine which skills to update
  let toUpdate: string[];
  if (skill) {
    if (!lock.skills[skill]) {
      console.error(red(`Skill "${skill}" is not installed.`));
      process.exit(1);
      return;
    }
    toUpdate = [skill];
  } else if (opts.all) {
    toUpdate = skillNames;
  } else {
    console.log(
      yellow("Specify a skill name or use --all to update everything.")
    );
    console.log(dim(`Installed: ${skillNames.join(", ")}`));
    return;
  }

  const agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No agents detected. Cannot update."));
    process.exit(1);
    return;
  }

  let updated = 0;

  for (const name of toUpdate) {
    const entry = lock.skills[name];
    const spin = spinner(`Checking ${name}`);

    try {
      const remote = await getSkill(name);
      spin.stop();

      // Compare versions
      if (remote.sha && remote.sha === entry.sha) {
        console.log(dim(`${name}: already up to date`));
        continue;
      }

      console.log(
        `${bold(name)}: ${dim(entry.sha?.slice(0, 8) || "unknown")} -> ${green(remote.sha?.slice(0, 8) || "new")}`
      );

      // Fetch new content
      if (!remote.content) {
        console.log(yellow(`  No content available from registry for ${name}. Skipping.`));
        continue;
      }

      // Run scan on new version
      const scanResult = runTier1Scan(remote.content);
      const verdictColor =
        scanResult.verdict === "PASS"
          ? green
          : scanResult.verdict === "CONCERNS"
            ? yellow
            : red;
      console.log(
        `  Scan: ${verdictColor(scanResult.verdict)} (${scanResult.score}/100)`
      );

      if (scanResult.verdict === "FAIL") {
        console.log(red(`  Refusing to update ${name}: scan FAILED`));
        continue;
      }

      // Install to each agent
      const sha = createHash("sha256")
        .update(remote.content)
        .digest("hex")
        .slice(0, 12);

      for (const agent of agents) {
        const skillDir = join(
          process.cwd(),
          agent.localSkillsDir,
          name
        );
        try {
          mkdirSync(skillDir, { recursive: true });
          writeFileSync(
            join(skillDir, "SKILL.md"),
            remote.content,
            "utf-8"
          );
        } catch {
          // Silently skip write failures for update
        }
      }

      // Update lockfile entry
      lock.skills[name] = {
        ...entry,
        version: remote.version || entry.version,
        sha,
        tier: remote.tier || entry.tier,
        installedAt: new Date().toISOString(),
      };

      updated++;
    } catch (err) {
      spin.stop();
      console.log(
        yellow(`  ${name}: `) +
          dim(`could not fetch from registry (${(err as Error).message})`)
      );
    }
  }

  writeLockfile(lock);

  console.log(
    `\n${updated > 0 ? green(`${updated} skill${updated === 1 ? "" : "s"} updated`) : dim("No updates available")}`
  );
}
