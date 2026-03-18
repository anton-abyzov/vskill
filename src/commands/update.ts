// ---------------------------------------------------------------------------
// vskill update -- update installed skills
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readLockfile, writeLockfile } from "../lockfile/index.js";
import { ensureFrontmatter } from "../installer/frontmatter.js";
import { ensureSkillMdNaming } from "../installer/migrate.js";
import { getSkill } from "../api/client.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { filterAgents } from "../utils/agent-filter.js";
import { runTier1Scan } from "../scanner/index.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { fetchFromSource } from "../updater/source-fetcher.js";
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
  agent?: string | string[];
}

export async function updateCommand(
  skill: string | undefined,
  opts: UpdateOptions
): Promise<void> {
  const lock = readLockfile();
  if (!lock) {
    console.error(
      yellow("No vskill.lock found. Run ") +
        cyan("vskill install") +
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

  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No agents detected. Cannot update."));
    process.exit(1);
    return;
  }
  // Apply --agent filter (same as install command)
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
  }

  let updated = 0;

  for (const name of toUpdate) {
    const entry = lock.skills[name];
    const parsed = parseSource(entry.source ?? "");
    const spin = spinner(`Checking ${name}`);

    try {
      // 1. Try source-aware fetch first
      let result = await fetchFromSource(parsed, name, entry);

      // 2. For local sources that returned null: skip (no registry fallback)
      if (result === null && parsed.type === "local") {
        spin.stop();
        console.log(dim(`${name}: managed by specweave refresh-plugins — skipping`));
        continue;
      }

      // 3. Fall back to registry for unknown/failed sources
      if (result === null) {
        try {
          const remote = await getSkill(name);
          if (remote.content) {
            const sha = createHash("sha256")
              .update(remote.content)
              .digest("hex")
              .slice(0, 12);
            result = {
              content: remote.content,
              version: remote.version || entry.version,
              sha,
              tier: remote.tier || entry.tier,
            };
          }
        } catch {
          // Registry also failed
        }
      }

      spin.stop();

      if (!result) {
        console.log(
          yellow(`  ${name}: `) +
            dim("could not fetch update from any source")
        );
        continue;
      }

      // 4. SHA comparison — skip if unchanged
      if (result.sha === entry.sha) {
        console.log(dim(`${name}: already up to date`));
        continue;
      }

      console.log(
        `${bold(name)}: ${dim(entry.sha?.slice(0, 8) || "unknown")} -> ${green(result.sha?.slice(0, 8) || "new")}`
      );

      // 5. Security scan
      const scanResult = runTier1Scan(result.content);
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

      // 6. Install to each agent
      const processedContent = ensureFrontmatter(result.content, name);
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
            processedContent,
            "utf-8"
          );
        } catch {
          // Silently skip write failures for update
        }
      }
      // Defense-in-depth: enforce SKILL.md naming after update
      for (const agent of agents) {
        const agentBase = join(process.cwd(), agent.localSkillsDir);
        ensureSkillMdNaming(agentBase);
      }

      // 7. Update lockfile entry — preserve source and all existing fields
      lock.skills[name] = {
        ...entry,
        version: result.version,
        sha: result.sha,
        tier: result.tier,
        installedAt: new Date().toISOString(),
      };

      updated++;
    } catch (err) {
      spin.stop();
      console.log(
        yellow(`  ${name}: `) +
          dim(`update failed (${(err as Error).message})`)
      );
    }
  }

  writeLockfile(lock);

  console.log(
    `\n${updated > 0 ? green(`${updated} skill${updated === 1 ? "" : "s"} updated`) : dim("No updates available")}`
  );
}
