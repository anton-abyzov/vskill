// 0823 — Comprehensive Origin Resolver for Skill Provenance.
//
// Determines where a skill came from so the Versions tab + rescan can fetch
// upstream version history. Walks five tiers; first hit wins.
//
//   (1) project lockfile     `<root>/vskill.lock`
//   (2) user-global lockfile `~/.agents/vskill.lock`
//   (3) frontmatter `source:` field in SKILL.md (deferred — present in interface,
//       wired in a follow-up; today this tier is reserved and falls through.)
//   (4) Anthropic-skill registry (well-known names → anthropics/skills/<name>)
//       — see ANTHROPIC_SKILL_REGISTRY below. Verified-live URL pattern.
//   (5) bare-name fallback / unknown (provider="local", no upstream)
//
// IMPORTANT: cache resolved envelopes to avoid repeated lockfile reads, but
// DO NOT cache the "local" fallback — a future install would otherwise be
// invisible until studio restart.

import { homedir } from "node:os";
import { join } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import { parseSource } from "../resolvers/source-resolver.js";

export type OriginSource = "platform" | "anthropic-registry" | "local";
export type OriginProvider = "vskill" | "anthropic" | "local";

export interface OriginEnvelope {
  source: OriginSource;
  owner: string | null;
  repo: string | null;
  provider: OriginProvider;
  trackedForUpdates: boolean;
  /** Lockfile dir that produced the hit (for debugging). */
  lockfilePath?: string;
  /** Frontmatter source string when Tier 3 hits (debug). */
  frontmatterSource?: string;
  /** Registry key when Tier 4 hits (debug). */
  registryMatch?: string;
}

/**
 * Well-known Anthropic-shipped skills. Mapped to their canonical
 * `anthropics/skills/<name>` upstream (the verified-skill.com URL pattern
 * for skills published from the `anthropics/skills` GitHub repo) so the
 * Versions tab can fetch upstream history even when the skill arrived
 * without a vskill lockfile entry.
 *
 * Verified live (2026-05-01): `https://verified-skill.com/api/v1/skills/anthropics/skills/pptx/versions`
 * returns `{ versions, count, unversioned, currentVersion }` JSON. The
 * `anthropic-skills/<name>` pattern (with hyphen) returns 404.
 *
 * Maintained as a hand-curated list. Add new names as Anthropic ships them.
 */
export const ANTHROPIC_SKILL_REGISTRY: Record<string, { owner: string; repo: string }> = {
  "slack-messaging": { owner: "anthropics", repo: "skills" },
  pptx: { owner: "anthropics", repo: "skills" },
  "excalidraw-diagram-generator": { owner: "anthropics", repo: "skills" },
  "excalidraw-skill": { owner: "anthropics", repo: "skills" },
  "frontend-design": { owner: "anthropics", repo: "skills" },
  gws: { owner: "anthropics", repo: "skills" },
  "remotion-best-practices": { owner: "anthropics", repo: "skills" },
  "social-media-posting": { owner: "anthropics", repo: "skills" },
  "webapp-testing": { owner: "anthropics", repo: "skills" },
  "obsidian-brain": { owner: "anthropics", repo: "skills" },
  nanobanana: { owner: "anthropics", repo: "skills" },
  pdf: { owner: "anthropics", repo: "skills" },
  docx: { owner: "anthropics", repo: "skills" },
  xlsx: { owner: "anthropics", repo: "skills" },
  "skill-creator": { owner: "anthropics", repo: "skills" },
};

// 0823 simplify: cap the cache so a long-lived studio process polling many
// distinct (plugin, skill) combinations doesn't grow unboundedly. The Map's
// insertion-order semantics give us cheap LRU-ish eviction: when we exceed
// MAX_CACHE_ENTRIES, drop the oldest entries until under the soft limit.
const MAX_CACHE_ENTRIES = 1000;
const PRUNE_TARGET = 500;
const cache = new Map<string, OriginEnvelope>();

function setCacheEntry(key: string, value: OriginEnvelope): void {
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const dropCount = cache.size - PRUNE_TARGET;
    let i = 0;
    for (const k of cache.keys()) {
      if (i++ >= dropCount) break;
      cache.delete(k);
    }
  }
}

/** Test-only: clear the in-process cache between cases. */
export function resetOriginResolverCache(): void {
  cache.clear();
}

function tryLockfileTier(
  skill: string,
  dir: string,
): { owner: string; repo: string } | null {
  let lock;
  try {
    lock = readLockfile(dir);
  } catch {
    return null;
  }
  const entry = lock?.skills?.[skill];
  if (!entry?.source) return null;
  let parsed;
  try {
    parsed = parseSource(entry.source);
  } catch {
    return null;
  }
  if (
    (parsed.type === "github" ||
      parsed.type === "github-plugin" ||
      parsed.type === "marketplace") &&
    parsed.owner &&
    parsed.repo
  ) {
    return { owner: parsed.owner, repo: parsed.repo };
  }
  return null;
}

/**
 * Resolve a skill's full provenance envelope.
 *
 * @param skill — bare skill slug (e.g. "slack-messaging")
 * @param plugin — the plugin/agent dir the skill is mounted under (e.g. ".claude")
 * @param root — the studio process cwd (project root)
 */
export async function resolveSkillOrigin(
  skill: string,
  plugin: string | null,
  root: string,
): Promise<OriginEnvelope> {
  const cacheKey = `${plugin ?? ""}::${skill}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Tier 1 — project lockfile
  const projectHit = tryLockfileTier(skill, root);
  if (projectHit) {
    const env: OriginEnvelope = {
      source: "platform",
      owner: projectHit.owner,
      repo: projectHit.repo,
      provider: "vskill",
      trackedForUpdates: true,
      lockfilePath: root,
    };
    setCacheEntry(cacheKey, env);
    return env;
  }

  // Tier 2 — user-global lockfile (~/.agents/vskill.lock)
  const globalDir = join(homedir(), ".agents");
  const globalHit = tryLockfileTier(skill, globalDir);
  if (globalHit) {
    const env: OriginEnvelope = {
      source: "platform",
      owner: globalHit.owner,
      repo: globalHit.repo,
      provider: "vskill",
      trackedForUpdates: true,
      lockfilePath: globalDir,
    };
    setCacheEntry(cacheKey, env);
    return env;
  }

  // Tier 3 — frontmatter `source:` field. Reserved; not yet wired (no
  // installed-skill writes a frontmatter origin today). Tier-skipped silently.

  // Tier 4 — Anthropic-skill registry
  const registryHit = ANTHROPIC_SKILL_REGISTRY[skill];
  if (registryHit) {
    const env: OriginEnvelope = {
      source: "anthropic-registry",
      owner: registryHit.owner,
      repo: registryHit.repo,
      provider: "anthropic",
      trackedForUpdates: true,
      registryMatch: skill,
    };
    setCacheEntry(cacheKey, env);
    return env;
  }

  // Tier 5 — local / unknown. NOT cached so a future install becomes visible
  // without a studio restart.
  return {
    source: "local",
    owner: null,
    repo: null,
    provider: "local",
    trackedForUpdates: false,
  };
}
