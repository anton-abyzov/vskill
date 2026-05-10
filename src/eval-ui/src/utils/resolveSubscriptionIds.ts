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
 *
 * 0838 source-origin extension (AC-US2-01, AC-US2-05)
 * ---------------------------------------------------
 * Locally-authored skills (`origin === "source"`) carry no UUID/slug in
 * their installed-skill record. `resolveSubscriptionIdsWithSourceOrigin`
 * batches these against `/api/v1/skills/lookup-by-name` (passed in as the
 * `lookup` function so the resolver stays platform-agnostic) and merges
 * any matched UUID/slug into the SSE subscription filter. Match key is
 * case-insensitive `name` + exact `author`. Source-origin entries with no
 * `author` are silently excluded from the lookup batch (no error).
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
 * 0838: source-origin skill descriptor passed to
 * `resolveSubscriptionIdsWithSourceOrigin`. Authored from `SKILL.md`
 * frontmatter on the studio side.
 */
export interface SourceOriginEntry {
  plugin: string;
  skill: string;
  origin: "source";
  /** Frontmatter `author`. Required for the lookup — entries without are dropped. */
  author?: string;
  /** Frontmatter `version` (local working copy). Forwarded to polling, not lookup. */
  localVersion?: string;
}

/**
 * 0838: lookup-by-name result row. The platform's
 * `/api/v1/skills/lookup-by-name` route returns one row per requested
 * `(name, author)` pair; rows with no matching registry skill have
 * neither `uuid` nor `slug` populated and are filtered out by the
 * resolver.
 */
export interface SourceOriginLookupResult {
  name: string;
  author: string;
  uuid?: string;
  slug?: string;
}

/**
 * 0838: lookup function signature — passed in by the caller so the
 * resolver does not have to know about the platform-proxy URL or the
 * `fetch`/SWR transport.
 */
export type SourceOriginLookup = (
  entries: Array<{ name: string; author: string }>,
) => Promise<SourceOriginLookupResult[]>;

/**
 * 0836 hardening (F-003): shared type guard so uuid/slug duck-checks
 * cannot silently widen if the upstream schema ever changes
 * `string | undefined` → `string | null`. Reused below and exported for
 * the source-origin lookup path.
 */
export function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
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
    const hasUuid = nonEmptyString(s.uuid);
    const hasSlug = nonEmptyString(s.slug);
    if (!hasUuid && !hasSlug) continue;
    const entry: ResolvedSubscriptionId = {};
    if (hasUuid) entry.uuid = s.uuid;
    if (hasSlug) entry.slug = s.slug;
    out.push(entry);
  }
  return out;
}

/**
 * 0838 T-007: extended resolver that also handles source-origin skills.
 *
 * Behaviour:
 *   - Installed entries pass through `resolveSubscriptionIds` unchanged.
 *   - Source-origin entries with an `author` are batched into a single
 *     `lookup({name, author})` call. Returned rows with a `uuid` or
 *     `slug` are merged into the result; rows with neither are dropped.
 *   - Source-origin entries without an `author` are dropped silently
 *     (no error).
 *   - If `lookup` rejects, the source-origin block is skipped — installed
 *     entries are still returned (graceful degradation; polling covers the
 *     missed rows on the next cycle).
 */
export async function resolveSubscriptionIdsWithSourceOrigin(args: {
  installed: InstalledSkillEntry[];
  sourceOrigin: SourceOriginEntry[];
  lookup: SourceOriginLookup;
}): Promise<ResolvedSubscriptionId[]> {
  const installedResolved = resolveSubscriptionIds(args.installed);

  const lookupBatch = args.sourceOrigin
    .filter((s) => typeof s.author === "string" && s.author.length > 0)
    .map((s) => ({ name: s.skill, author: s.author as string }));

  if (lookupBatch.length === 0) {
    return installedResolved;
  }

  let rows: SourceOriginLookupResult[] = [];
  try {
    rows = await args.lookup(lookupBatch);
  } catch {
    // Fail soft — return installed-only. The polling fallback will catch up.
    return installedResolved;
  }

  const sourceOriginResolved: ResolvedSubscriptionId[] = [];
  for (const r of rows) {
    const hasUuid = typeof r.uuid === "string" && r.uuid.length > 0;
    const hasSlug = typeof r.slug === "string" && r.slug.length > 0;
    if (!hasUuid && !hasSlug) continue;
    const entry: ResolvedSubscriptionId = {};
    if (hasUuid) entry.uuid = r.uuid;
    if (hasSlug) entry.slug = r.slug;
    sourceOriginResolved.push(entry);
  }

  return [...installedResolved, ...sourceOriginResolved];
}
