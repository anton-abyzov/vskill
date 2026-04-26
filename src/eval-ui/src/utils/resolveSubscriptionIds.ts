/**
 * resolveSubscriptionIds — studio-side ID-format resolver for SSE subscriptions.
 *
 * ID-format contract (0736 / AC-US3-01)
 * --------------------------------------
 * UpdateHub (vskill-platform) accepts ONLY two ID formats in the
 * `?skills=<csv>` SSE filter:
 *   - Internal DB UUID (`Skill.id`), e.g. `0f1d2e…`
 *   - Public slug (`sk_published_<owner>/<repo>/<skill>`)
 *
 * The studio's installed-skill list uses `<plugin>/<skill>` local names
 * (e.g. `.claude/greet-anton`). These are silently dropped by UpdateHub
 * and must NOT be passed as subscription IDs.
 *
 * This helper filters an installed-skill list to only those entries that
 * carry a resolvable platform identity (uuid and/or slug). Skills without
 * either are omitted — the polling fallback (usePluginsPolling) covers them.
 *
 * Callers are responsible for enriching SkillInfo entries with uuid/slug
 * before passing them here (e.g. via a backend /api/skills/installed
 * enrichment endpoint that maps plugin+skill → platform id).
 */

export interface InstalledSkillEntry {
  plugin: string;
  skill: string;
  /** Internal DB UUID (Skill.id). Undefined for local-only skills. */
  uuid?: string;
  /** Public slug: `sk_published_<owner>/<repo>/<skill>`. Undefined for local-only. */
  slug?: string;
}

export interface ResolvedSubscriptionId {
  uuid?: string;
  slug?: string;
}

/**
 * Map installed skills to their UpdateHub-compatible subscription IDs.
 *
 * Returns one entry per skill that has at least one resolvable platform ID.
 * Skills with neither uuid nor slug are silently omitted (AC-US3-02).
 */
export function resolveSubscriptionIds(
  skills: InstalledSkillEntry[],
): ResolvedSubscriptionId[] {
  const out: ResolvedSubscriptionId[] = [];
  for (const s of skills) {
    const hasUuid = typeof s.uuid === "string" && s.uuid.length > 0;
    const hasSlug = typeof s.slug === "string" && s.slug.length > 0;
    if (!hasUuid && !hasSlug) continue;
    const entry: ResolvedSubscriptionId = {};
    if (hasUuid) entry.uuid = s.uuid;
    if (hasSlug) entry.slug = s.slug;
    out.push(entry);
  }
  return out;
}
