// ---------------------------------------------------------------------------
// vskill update -- update installed skills
// ---------------------------------------------------------------------------

import { unlinkSync, rmdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
import {
  resolveVersion,
  extractFrontmatterVersion,
  setFrontmatterVersion,
} from "../utils/version.js";

/**
 * 0765: Return true when `a` is a strictly greater semver than `b`. Falls
 * back to lexical compare when either side isn't well-formed semver, so a
 * malformed input never crashes the update loop.
 */
export function isVersionGreater(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return Boolean(a) && !b;
  const re = /^(\d+)\.(\d+)\.(\d+)/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (!ma || !mb) return a > b;
  const [, a1, a2, a3] = ma.map(Number) as unknown as [unknown, number, number, number];
  const [, b1, b2, b3] = mb.map(Number) as unknown as [unknown, number, number, number];
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/**
 * 0765: Build the canonical platform skill name (`owner/repo/skill`) from a
 * parsed lockfile source descriptor. Returns null when the source isn't a
 * GitHub-shaped record we can address on the platform.
 */
export function canonicalNameFromParsedSource(
  parsed: { type: string; owner?: string | null; repo?: string | null },
  skill: string,
): string | null {
  if (
    (parsed.type === "github" ||
      parsed.type === "github-plugin" ||
      parsed.type === "marketplace") &&
    parsed.owner &&
    parsed.repo
  ) {
    return `${parsed.owner}/${parsed.repo}/${skill}`;
  }
  return null;
}

/**
 * 0765: Sync each agent's on-disk SKILL.md frontmatter to `newVersion`.
 * installSymlink writes the upstream content as-is, so when upstream's
 * SKILL.md frontmatter version differs from the resolved newVersion (e.g.
 * platform bumped logical version on a content-identical re-publish, or the
 * upstream simply forgot to update its own frontmatter), the file ends up
 * stale. Without this sync, the Studio header chip and Versions tab show
 * the old version after update — exactly the bug 0765 fixes.
 *
 * Pure-ish helper: takes the agents list + projectRoot + name + newVersion
 * and writes only when the on-disk version actually differs.
 */
export function syncFrontmatterVersionAfterUpdate(
  agents: { localSkillsDir: string }[],
  projectRoot: string,
  name: string,
  newVersion: string,
): void {
  for (const agent of agents) {
    const skillMdPath = join(projectRoot, agent.localSkillsDir, name, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;
    let onDisk: string;
    try {
      onDisk = readFileSync(skillMdPath, "utf8");
    } catch {
      continue;
    }
    const onDiskVersion = extractFrontmatterVersion(onDisk);
    if (onDiskVersion === newVersion) continue;
    try {
      writeFileSync(skillMdPath, setFrontmatterVersion(onDisk, newVersion), "utf8");
    } catch {
      // Non-fatal — keep going.
    }
  }
}
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
      // 0765: BUT the platform may have published a newer logical version
      // (content-identical re-publish, version bump only) that the source
      // fetch above doesn't see (GitHub HEAD lags the platform, or the
      // platform tracks a separate version timeline). Before bailing as
      // "up to date", do one cheap platform lookup using the canonical
      // owner/repo/skill name. If the platform reports a strictly greater
      // version, this is a metadata-only bump — content already matches
      // (SHA equal), so we sync frontmatter + lockfile to the new version
      // and skip the install rewrite entirely.
      if (result.sha === entry.sha) {
        const canonical = canonicalNameFromParsedSource(parsed, name);
        let platformResult: Awaited<ReturnType<typeof getSkill>> | null = null;
        if (canonical) {
          try {
            platformResult = await getSkill(canonical);
          } catch {
            platformResult = null;
          }
        }

        if (platformResult && isVersionGreater(platformResult.version, entry.version)) {
          const projectRoot = process.cwd();
          syncFrontmatterVersionAfterUpdate(agents, projectRoot, name, platformResult.version);
          lock.skills[name] = {
            ...entry,
            version: platformResult.version,
            tier: platformResult.tier || entry.tier,
            installedAt: new Date().toISOString(),
          };
          console.log(
            `${bold(name)}: ${dim(entry.version)} -> ${green(platformResult.version)} ${dim("(metadata-only bump)")}`,
          );
          updated++;
          continue;
        }
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

      // 0765: sync each agent's SKILL.md frontmatter to the resolved
      // newVersion. installSymlink writes upstream content as-is, so when
      // upstream's frontmatter version doesn't match newVersion (e.g.
      // upstream HEAD is at 1.0.2 frontmatter but we resolved 1.0.3 from
      // the platform), the file stays stale and the Studio header keeps
      // showing the old version after update.
      syncFrontmatterVersionAfterUpdate(agents, projectRoot, name, newVersion);

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
