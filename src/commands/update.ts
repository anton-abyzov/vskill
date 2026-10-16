// ---------------------------------------------------------------------------
// vskill update -- update installed skills
// ---------------------------------------------------------------------------

import { unlinkSync, rmdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
// 0706 T-005: `relative` + `sep` for cross-platform ghost-file cleanup guard.
import { join, resolve, relative, isAbsolute, sep as pathSep } from "node:path";
import os from "node:os";
import { readLockfile, writeLockfile } from "../lockfile/index.js";
import { resolveLockTargets, type LockTarget } from "../lockfile/scope.js";
import { resolveAgentGlobalSkillsDir } from "../agents/global-dirs.js";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { resolveTilde } from "../utils/paths.js";
import type { SkillLockEntry, VskillLock } from "../lockfile/types.js";
import { ensureSkillMdNaming } from "../installer/migrate.js";
import { installSymlink } from "../installer/canonical.js";
import { getSkill } from "../api/client.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { filterAgents } from "../utils/agent-filter.js";
import { runTier1Scan } from "../scanner/index.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { isPrivateSource, unconfirmedSkipNote } from "../lib/private-source.js";
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

/** Agent fields the update loop needs to find a skill's folders. */
type UpdateAgent = { localSkillsDir: string } & Partial<Pick<AgentDefinition, "id" | "globalSkillsDir">>;

/**
 * Every folder a skill lives in for one scope: each agent's skills dir plus
 * the shared `.agents/skills` copy (0894: agents that read the shared folder
 * have no link of their own). Project scope resolves under `root`; global
 * scope uses each agent's global dir and ~/.agents/skills.
 */
export function skillInstallDirs(
  agents: UpdateAgent[],
  root: string,
  name: string,
  global = false,
): string[] {
  if (!global) {
    const dirs = new Set([...agents.map((a) => a.localSkillsDir), ".agents/skills"]);
    return [...dirs].map((dir) => join(root, dir, name));
  }
  const dirs = new Set<string>();
  for (const a of agents) {
    if (!a.globalSkillsDir) continue;
    dirs.add(join(resolveAgentGlobalSkillsDir({ id: a.id ?? "", globalSkillsDir: a.globalSkillsDir }, resolveTilde), name));
  }
  dirs.add(join(os.homedir(), ".agents", "skills", name));
  return [...dirs];
}

function shellArg(value: string): string {
  return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The `vskill install ... --global` command that refreshes a user-level
 * plugin entry, or null when the entry is a single skill. The update loop
 * rewrites one skill folder per entry, so for a plugin it would write the
 * plugin's skills, joined into one SKILL.md, as a folder named after the
 * plugin in every agent's user-level dir; a `local:` entry would be
 * refreshed from the SpecWeave plugin cache whatever folder it came from.
 */
export function userLevelPluginReinstallCommand(name: string, entry: SkillLockEntry): string | null {
  const parsed = parseSource(entry.source ?? "");
  switch (parsed.type) {
    case "marketplace":
      return `vskill install ${parsed.owner}/${parsed.repo}/${parsed.pluginName} --global`;
    case "github-plugin":
      return `vskill install ${parsed.owner}/${parsed.repo} --plugin ${parsed.pluginName} --global`;
    case "local":
      return `vskill install --plugin-dir ${isAbsolute(parsed.baseName) ? shellArg(parsed.baseName) : "<folder>"} --plugin ${shellArg(name)} --global`;
    default:
      return entry.pluginDir || entry.marketplace ? `vskill install ${shellArg(entry.source || name)} --global` : null;
  }
}

/**
 * Whether a user-level skill is installed on this machine: a SKILL.md in
 * ~/.agents/skills or any detected agent's user-level dir, or its recorded
 * install path. A lock entry with none of these was removed by hand or is a
 * leftover (often in the older ~/vskill.lock); `update` leaves it alone
 * instead of installing it again. `vskill doctor --global` lists them.
 */
function userLevelSkillOnDisk(agents: UpdateAgent[], name: string, entry: SkillLockEntry): boolean {
  if (entry.installedPath && existsSync(entry.installedPath)) return true;
  return skillInstallDirs(agents, os.homedir(), name, true).some((dir) => existsSync(join(dir, "SKILL.md")));
}

/**
 * The lock to write back after an update run: the lock as it is on disk now,
 * with only the entries this run rewrote replaced. The fetches take a while,
 * and another process (the Studio, a second terminal) may have installed or
 * removed skills in the same lock meanwhile; writing the copy read at the
 * start would undo that.
 */
function lockToWrite(
  dir: string,
  lock: VskillLock,
  before: Map<string, SkillLockEntry | undefined>,
): VskillLock {
  let current: VskillLock | null = null;
  try {
    current = readLockfile(dir);
  } catch {
    current = null;
  }
  if (!current || current === lock || !current.skills) return lock;
  for (const [name, entry] of before) {
    if (lock.skills[name] !== entry && lock.skills[name]) current.skills[name] = lock.skills[name];
  }
  return current;
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
 * and writes only when the on-disk version actually differs. `global` syncs
 * the user-level folders instead of the project's.
 */
export function syncFrontmatterVersionAfterUpdate(
  agents: UpdateAgent[],
  projectRoot: string,
  name: string,
  newVersion: string,
  global = false,
): void {
  for (const dir of skillInstallDirs(agents, projectRoot, name, global)) {
    const skillMdPath = join(dir, "SKILL.md");
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
  /** Update user-level installs (~/.agents/vskill.lock) instead of the project's. */
  global?: boolean;
}

export async function updateCommand(
  skill: string | undefined,
  opts: UpdateOptions
): Promise<void> {
  const resolution = resolveLockTargets({ global: opts.global, read: readLockfile });
  const targets = resolution.targets;
  if (targets.length === 0) {
    if (resolution.scope === "global") {
      console.error(
        yellow(`No user-level vskill.lock found (${resolution.displayPath}). Run `) +
          cyan("vskill install <source> --global") +
          yellow(" first.")
      );
    } else {
      console.error(
        yellow("No vskill.lock found. Run ") +
          cyan("vskill install") +
          yellow(" first, or ") +
          cyan("vskill update --global") +
          yellow(" for user-level skills.")
      );
    }
    process.exit(1);
    return; // unreachable but satisfies TS
  }
  if (resolution.fellBackToGlobal) {
    console.log(dim(`No project vskill.lock here; updating user-level skills from ${resolution.displayPath}`));
  }

  const skillNames = targets.flatMap((t) => t.names);
  if (skillNames.length === 0) {
    console.log(dim("No skills installed. Nothing to update."));
    return;
  }

  // Determine which skills to update
  if (skill && !targets.some((t) => t.names.includes(skill))) {
    console.error(red(`Skill "${skill}" is not installed.`));
    if (resolution.scope === "project") {
      console.error(dim(`For a user-level skill run ${cyan(`vskill update ${skill} --global`)}.`));
    }
    process.exit(1);
    return;
  }
  // Default: update all installed skills (--all is now implicit)

  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No agents detected. Cannot update."));
    process.exit(1);
    return;
  }
  // Every detected agent, before --agent narrows the list: a user-level
  // skill installed for any of them counts as on disk.
  const detectedAgents = agents;
  // Apply --agent filter (same as install command)
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
  }

  let updated = 0;
  for (const target of targets) {
    const toUpdate = skill ? target.names.filter((n) => n === skill) : target.names;
    if (toUpdate.length === 0) continue;
    updated += await updateTarget(target, toUpdate, agents, opts, detectedAgents);
  }

  console.log(
    `\n${updated > 0 ? green(`${updated} skill${updated === 1 ? "" : "s"} updated`) : dim("No updates available")}`
  );
  // Skills GitHub could not confirm public (rate limit, outage) missed the
  // registry fallback this run; never let that pass silently.
  const skipNote = unconfirmedSkipNote();
  if (skipNote) console.error(yellow(skipNote));
}

/**
 * Update the given entries of one lockfile and write it back once. Project
 * targets install under the lock's directory; global targets install into
 * each agent's user-level skills dir and ~/.agents/skills.
 */
async function updateTarget(
  target: LockTarget,
  toUpdate: string[],
  agents: AgentDefinition[],
  opts: UpdateOptions,
  detectedAgents: AgentDefinition[] = agents,
): Promise<number> {
  const lock = target.lock;
  const global = target.scope === "global";
  // Project scope installs where the lock lives; global scope ignores the root.
  const projectRoot = global ? os.homedir() : target.dir;
  // Entries as read, to tell which ones this run rewrote (see lockToWrite).
  const before = new Map(toUpdate.map((n) => [n, lock.skills[n]]));
  let updated = 0;

  for (const name of toUpdate) {
    const entry = lock.skills[name];

    // Skip pinned skills unless --force is used
    if (entry.pinnedVersion && !opts.force) {
      console.log(dim(`${name}: pinned at ${entry.pinnedVersion} — skipping`));
      continue;
    }

    // A user-level plugin entry (marketplace, --plugin or --plugin-dir
    // install) stands for several skill folders; this loop rewrites one
    // folder per entry. See userLevelPluginReinstallCommand.
    const reinstall = global ? userLevelPluginReinstallCommand(name, entry) : null;
    if (reinstall) {
      console.log(dim(`${name}: plugin — update it with ${cyan(reinstall)}; skipping`));
      continue;
    }
    if (global && !userLevelSkillOnDisk(detectedAgents, name, entry)) {
      console.log(dim(`${name}: in ${join(target.dir, "vskill.lock")} but not on disk — skipping; reinstall it with ${cyan("vskill install")} or remove the entry`));
      continue;
    }

    const parsed = parseSource(entry.source ?? "");
    const spin = spinner(`Checking ${name}`);

    try {
      // 1. Try source-aware fetch first
      let result = await fetchFromSource(parsed, name, entry);

      // Private repos — and GitHub repos not confirmed public — are never
      // looked up on the registry: their names must not leave the machine,
      // and a public skill with the same name must not replace them.
      const privateSource = await isPrivateSource(entry);

      // 2. Fall back to registry for unknown/failed sources (never for a
      // private source, see above).
      if (result === null && !privateSource) {
        try {
          const remote = await getSkill(name);
          if (remote.content) {
            const files: Record<string, string> = { "SKILL.md": remote.content };
            // String mode — install writes computeSha(content) to the lockfile.
            const sha = computeSha(remote.content);
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
      // F4: older vskill versions wrote the files-map sha into the lockfile
      // on update, while install always writes the content-string sha. Accept
      // the legacy map-mode sha on compare (and heal it to canonical below)
      // so unchanged skills don't phantom-update.
      const legacySha = result.files ? computeSha(result.files) : null;
      if (result.sha === entry.sha || legacySha === entry.sha) {
        const canonical = privateSource ? null : canonicalNameFromParsedSource(parsed, name);
        let platformResult: Awaited<ReturnType<typeof getSkill>> | null = null;
        if (canonical) {
          try {
            platformResult = await getSkill(canonical);
          } catch {
            platformResult = null;
          }
        }

        if (platformResult && isVersionGreater(platformResult.version, entry.version)) {
          syncFrontmatterVersionAfterUpdate(agents, projectRoot, name, platformResult.version, global);
          lock.skills[name] = {
            ...entry,
            version: platformResult.version,
            // Canonical (string-mode) sha — heals legacy map-mode entries.
            sha: result.sha,
            tier: platformResult.tier || entry.tier,
            installedAt: new Date().toISOString(),
          };
          console.log(
            `${bold(name)}: ${dim(entry.version)} -> ${green(platformResult.version)} ${dim("(metadata-only bump)")}`,
          );
          updated++;
          continue;
        }
        // Heal a legacy map-mode sha to the canonical install identity
        // without reporting an update (content is unchanged).
        if (entry.sha !== result.sha) {
          lock.skills[name] = { ...entry, sha: result.sha };
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
      // 0894: installs record the whole skill folder in `files`. A fetcher
      // that returns only SKILL.md says nothing about the rest of the folder,
      // so those files are kept (never deleted as "ghosts").
      const fetchedBundle = !!result.files &&
        Object.keys(result.files).some((k) => k !== "SKILL.md");
      const newFileKeys = fetchedBundle
        ? Object.keys(result.files!).sort()
        : [...new Set(["SKILL.md", ...(entry.files ?? [])])].sort();

      // 8. Ghost file cleanup (every agent folder plus the canonical
      // .agents/skills copy) + install via canonical installer
      for (const skillDir of skillInstallDirs(agents, projectRoot, name, global)) {
        try {
          cleanupGhostFiles(skillDir, entry.files, newFileKeys);
        } catch {
          // Non-fatal — continue with install
        }
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
          { global, projectRoot },
          agentFiles,
        );
      } catch (err) {
        // Keep the old lock entry: recording the new sha for files that were
        // never written would report the skill as up to date next run.
        console.log(yellow(`  ${name}: `) + dim(`could not write the update (${(err as Error).message})`));
        continue;
      }

      // Defense-in-depth: enforce SKILL.md naming after update. Project
      // scope only: the user-level dirs hold skills vskill did not install.
      if (!global) {
        for (const agent of agents) {
          const agentBase = join(projectRoot, agent.localSkillsDir);
          ensureSkillMdNaming(agentBase);
        }
      }

      // 0765: sync each agent's SKILL.md frontmatter to the resolved
      // newVersion. installSymlink writes upstream content as-is, so when
      // upstream's frontmatter version doesn't match newVersion (e.g.
      // upstream HEAD is at 1.0.2 frontmatter but we resolved 1.0.3 from
      // the platform), the file stays stale and the Studio header keeps
      // showing the old version after update.
      syncFrontmatterVersionAfterUpdate(agents, projectRoot, name, newVersion, global);

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

  writeLockfile(lockToWrite(target.dir, lock, before), target.dir);
  return updated;
}
