// ---------------------------------------------------------------------------
// vskill update -- update installed skills
// ---------------------------------------------------------------------------

import { unlinkSync, rmdirSync, readdirSync } from "node:fs";
// 0706 T-005: `relative` + `sep` for cross-platform ghost-file cleanup guard.
import { join, resolve, relative, sep as pathSep } from "node:path";
import { readLockfile, writeLockfile } from "../lockfile/index.js";
import { ensureSkillMdNaming } from "../installer/migrate.js";
import { installSymlink } from "../installer/canonical.js";
import { getSkill } from "../api/client.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { filterAgents } from "../utils/agent-filter.js";
import { runTier1Scan } from "../scanner/index.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { fetchFromSource, computeSha } from "../updater/source-fetcher.js";
import { resolveVersion, extractFrontmatterVersion } from "../utils/version.js";
import {
  bold,
  green,
  red,
  yellow,
  dim,
  cyan,
  spinner,
} from "../utils/output.js";

/**
 * Remove files that existed in a previous skill version but no longer exist
 * in the new version. Only runs when oldFiles is defined (post-migration).
 */
function cleanupGhostFiles(
  skillDir: string,
  oldFiles: string[] | undefined,
  newFiles: string[],
): void {
  if (!oldFiles) return;
  const resolvedBase = resolve(skillDir);
  const newSet = new Set(newFiles);
  for (const file of oldFiles) {
    if (!newSet.has(file)) {
      const target = resolve(skillDir, file);
      // 0706 T-005: cross-platform "is target inside resolvedBase?" check.
      // The old `target.startsWith(resolvedBase + "/")` was POSIX-only and
      // silently no-op'd on Windows (which uses `\`), leaving stale files
      // behind. `path.relative` returns "" when equal and a leading ".."
      // iff the target escapes the base — portable across separators.
      const rel = relative(resolvedBase, target);
      const insideBase =
        target === resolvedBase ||
        (rel !== "" && rel !== ".." && !rel.startsWith(".." + pathSep) && !rel.startsWith("../"));
      if (!insideBase && target !== resolvedBase) continue;
      try {
        unlinkSync(target);
      } catch {
        // File may already be missing — ignore
      }
    }
  }
  // Clean up empty directories left behind
  const dirsToCheck = new Set<string>();
  for (const file of oldFiles) {
    if (!newSet.has(file)) {
      const dir = resolve(skillDir, file, "..");
      // 0706 T-005: same path.relative swap for the dir-cleanup guard.
      const rel = relative(resolvedBase, dir);
      const strictlyInside =
        rel !== "" && rel !== ".." && !rel.startsWith(".." + pathSep) && !rel.startsWith("../");
      if (dir !== resolvedBase && strictlyInside) {
        dirsToCheck.add(dir);
      }
    }
  }
  // Remove empty dirs bottom-up
  const sortedDirs = [...dirsToCheck].sort((a, b) => b.length - a.length);
  for (const dir of sortedDirs) {
    try {
      const entries = readdirSync(dir);
      if (entries.length === 0) {
        rmdirSync(dir);
      }
    } catch {
      // Directory may already be removed — ignore
    }
  }
}

interface UpdateOptions {
  all?: boolean;
  force?: boolean;
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
  } else {
    // Default: update all installed skills (--all is now implicit)
    toUpdate = skillNames;
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

    // Skip pinned skills unless --force is used
    if (entry.pinnedVersion && !opts.force) {
      console.log(dim(`${name}: pinned at ${entry.pinnedVersion} — skipping`));
      continue;
    }

    const parsed = parseSource(entry.source ?? "");
    const spin = spinner(`Checking ${name}`);

    try {
      // 1. Try source-aware fetch first
      let result = await fetchFromSource(parsed, name, entry);

      // 2. Fall back to registry for unknown/failed sources
      if (result === null) {
        try {
          const remote = await getSkill(name);
          if (remote.content) {
            const files: Record<string, string> = { "SKILL.md": remote.content };
            const sha = computeSha(files);
            result = {
              content: remote.content,
              version: remote.version || entry.version,
              sha,
              tier: remote.tier || entry.tier,
              files,
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

      // 6. Resolve version
      const newVersion = resolveVersion({
        serverVersion: parsed.type === "registry" ? result.version : undefined,
        frontmatterVersion: extractFrontmatterVersion(result.content),
        currentVersion: entry.version,
        hashChanged: true,
        isFirstInstall: false,
      });

      // 7. Determine new file manifest
      const newFileKeys = result.files
        ? Object.keys(result.files).sort()
        : ["SKILL.md"];

      // 8. Ghost file cleanup + install via canonical installer
      const projectRoot = process.cwd();
      for (const agent of agents) {
        const skillDir = join(projectRoot, agent.localSkillsDir, name);
        try {
          cleanupGhostFiles(skillDir, entry.files, newFileKeys);
        } catch {
          // Non-fatal — continue with install
        }
      }
      // Also clean ghost files in canonical dir
      const canonicalSkillDir = join(projectRoot, ".agents", "skills", name);
      try {
        cleanupGhostFiles(canonicalSkillDir, entry.files, newFileKeys);
      } catch {
        // Non-fatal
      }

      // Extract agentFiles (non-SKILL.md files) from the files map
      let agentFiles: Record<string, string> | undefined;
      if (result.files) {
        const extra: Record<string, string> = {};
        for (const [relPath, fileContent] of Object.entries(result.files)) {
          if (relPath !== "SKILL.md") {
            extra[relPath] = fileContent;
          }
        }
        if (Object.keys(extra).length > 0) {
          agentFiles = extra;
        }
      }

      try {
        installSymlink(
          name,
          result.content,
          agents,
          { global: false, projectRoot },
          agentFiles,
        );
      } catch {
        // Silently skip install failures for update
      }

      // Defense-in-depth: enforce SKILL.md naming after update
      for (const agent of agents) {
        const agentBase = join(projectRoot, agent.localSkillsDir);
        ensureSkillMdNaming(agentBase);
      }

      // 9. Update lockfile entry — preserve source and all existing fields
      lock.skills[name] = {
        ...entry,
        version: newVersion,
        sha: result.sha,
        tier: result.tier,
        installedAt: new Date().toISOString(),
        files: newFileKeys,
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
