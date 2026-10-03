// ---------------------------------------------------------------------------
// studio-privacy.ts — decides whether a skill the Studio lists may be sent to
// verified-skill.com (update checks, ID lookups, version history).
//
// A skill counts as private unless something confirms it is public:
//   1. A vskill.lock entry for it (keyed by the skill, or by the plugin it
//      ships in) — checked with isPrivateSource (GitHub, fail closed).
//   2. A skill the user authors: its checkout's GitHub `origin` must be a
//      repo GitHub confirms is public. No remote means private.
//   3. A Claude Code plugin-cache skill: the marketplace clone's GitHub
//      `origin` (~/.claude/plugins/marketplaces/<marketplace>) must be public.
//   4. A name from the Anthropic skill registry (public upstream).
// Anything else (an installed skill nobody recorded) fails closed.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import type { SkillLockEntry, VskillLock } from "../lockfile/types.js";
import {
  isPrivateOrUnknownRepo,
  isPrivateSource,
  localDirGitHubRepo,
  type GitHubRepoRef,
} from "../lib/private-source.js";
import { classifyOrigin } from "../eval/skill-scanner.js";
import { ANTHROPIC_SKILL_REGISTRY } from "./origin-resolver.js";
import { getSkillDirEntry } from "./skill-dir-registry.js";
import { resolveSkillDir } from "./skill-resolver.js";

export interface StudioSkillRef {
  skill: string;
  plugin?: string | null;
  dir?: string | null;
  origin?: "source" | "installed";
  pluginName?: string | null;
  pluginMarketplace?: string | null;
}

/** The project and user-global lockfiles, in lookup order. Never throws. */
export function readStudioLocks(root: string): Array<VskillLock | null> {
  const read = (dir: string): VskillLock | null => {
    try {
      return readLockfile(dir);
    } catch {
      return null;
    }
  };
  return [read(root), read(join(homedir(), ".agents"))];
}

/**
 * The lock entry a listed skill came from: its own key, the plugin it ships
 * in (plugin installs are keyed by plugin name), or an entry whose recorded
 * files include `<skill>/SKILL.md`.
 */
export function findLockEntryForStudioSkill(
  locks: Array<VskillLock | null | undefined>,
  s: StudioSkillRef,
): SkillLockEntry | null {
  const pluginKeys = [s.pluginName, s.plugin].filter(
    (p): p is string => !!p && !p.startsWith("."),
  );
  for (const lock of locks) {
    const skills = lock?.skills;
    if (!skills) continue;
    if (skills[s.skill]) return skills[s.skill];
    for (const key of pluginKeys) {
      const entry = skills[key];
      if (!entry) continue;
      if (s.pluginMarketplace && entry.marketplace && entry.marketplace !== s.pluginMarketplace) continue;
      return entry;
    }
    const file = `${s.skill}/SKILL.md`;
    for (const entry of Object.values(skills)) {
      if (entry.files?.some((f) => f === file || f.endsWith(`/${file}`))) return entry;
    }
  }
  return null;
}

// `git remote get-url` runs once per directory per process.
const remoteCache = new Map<string, GitHubRepoRef | null>();

function cachedRemote(dir: string): GitHubRepoRef | null {
  if (!remoteCache.has(dir)) remoteCache.set(dir, localDirGitHubRepo(dir, { allowParentCheckout: true }));
  return remoteCache.get(dir) ?? null;
}

/** @internal test-only */
export function _resetStudioPrivacyForTests(): void {
  remoteCache.clear();
  verdicts.clear();
}

async function isPrivateRemote(dir: string | null | undefined): Promise<boolean> {
  const gh = dir ? cachedRemote(dir) : null;
  if (!gh) return true;
  return isPrivateOrUnknownRepo(gh.owner, gh.repo);
}

// Verdicts from the last skill listing, keyed "<plugin>/<skill>", so the
// per-skill routes (versions, diff, rescan) agree with the sidebar.
const verdicts = new Map<string, boolean>();

/** True when nothing about this listed skill may be sent to the platform. */
export async function isPrivateStudioSkill(
  s: StudioSkillRef,
  locks: Array<VskillLock | null | undefined>,
): Promise<boolean> {
  const verdict = await decide(s, locks);
  if (s.plugin) verdicts.set(`${s.plugin}/${s.skill}`, verdict);
  return verdict;
}

/**
 * The same decision for a per-skill route that only has (plugin, skill):
 * reuses the listing's verdict, else rebuilds the skill's location.
 */
export async function isPrivateStudioSkillAt(
  skill: string,
  plugin: string | null,
  root: string,
): Promise<boolean> {
  const known = plugin ? verdicts.get(`${plugin}/${skill}`) : undefined;
  if (known !== undefined) return known;
  let dir: string | null = plugin ? getSkillDirEntry(plugin, skill)?.dir ?? null : null;
  if (!dir && plugin) {
    try {
      dir = resolveSkillDir(root, plugin, skill);
    } catch {
      dir = null;
    }
  }
  const registered = plugin ? getSkillDirEntry(plugin, skill)?.origin : undefined;
  const origin = registered ?? (dir ? classifyOrigin(dir, root) : undefined);
  const marketplace = dir?.match(/[\\/]\.claude[\\/]plugins[\\/]cache[\\/]([^\\/]+)[\\/]/)?.[1] ?? null;
  return decide(
    { skill, plugin, dir, origin, pluginName: marketplace ? plugin : null, pluginMarketplace: marketplace },
    readStudioLocks(root),
  );
}

async function decide(
  s: StudioSkillRef,
  locks: Array<VskillLock | null | undefined>,
): Promise<boolean> {
  // A skill the user authors is judged by its own checkout's upstream; a
  // same-named lock entry belongs to some other install.
  if (s.origin === "source") return isPrivateRemote(s.dir);
  const entry = findLockEntryForStudioSkill(locks, s);
  if (entry) return isPrivateSource(entry);
  if (s.pluginMarketplace) {
    return isPrivateRemote(join(homedir(), ".claude", "plugins", "marketplaces", s.pluginMarketplace));
  }
  if (Object.prototype.hasOwnProperty.call(ANTHROPIC_SKILL_REGISTRY, s.skill)) return false;
  return true;
}
