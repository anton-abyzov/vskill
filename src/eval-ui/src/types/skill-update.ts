/**
 * 0708 T-002 mirror — cross-repo contract for skill-update push pipeline.
 *
 * Kept in sync with `vskill-platform/src/lib/skill-update/types.ts`.
 * The Studio is a sibling repo, so we cannot import the platform file
 * directly; re-declaring the same shape here is the agreed boundary.
 */

export interface SkillUpdateEvent {
  type: "skill.updated";
  eventId: string;
  skillId: string;
  /**
   * Public skill slug ID (e.g. `sk_published_acme/foo/bar`) — increment 0732.
   *
   * Augmented by the platform's publish endpoint so SSE subscribers can
   * filter using either the internal UUID (`skillId`) or the public slug
   * surfaced by the discovery API. Optional for backwards compatibility
   * with pre-0732 in-flight events.
   */
  skillSlug?: string;
  version: string;
  gitSha: string;
  diffSummary?: string;
  publishedAt: string;
}

export interface UpdateStoreEntry {
  skillId: string;
  version: string;
  diffSummary?: string;
  eventId: string;
  publishedAt: string;
  /** Local wall-clock the entry landed in the store (ms since epoch). */
  receivedAt: number;
}

export type StreamStatus = "connecting" | "connected" | "fallback";
