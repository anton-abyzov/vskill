// ---------------------------------------------------------------------------
// Shared skill display helpers — used by both `find` and `add` commands
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";
import { bold, dim, cyan, yellow, green, red, link, formatInstalls } from "./output.js";

/**
 * Extract `owner/repo` from a GitHub URL.
 */
export function extractBaseRepo(repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/([^/]+\/[^/]+?)(?:\/tree\/|\.git|$)/);
  return match ? match[1] : null;
}

/**
 * Format skill display: `owner/repo/skill-name`.
 * Uses slug fields when available, falls back to extracting from repoUrl/name.
 */
export function formatSkillId(r: SkillSearchResult): string {
  const displayName = r.skillSlug || r.name.split("/").pop() || r.name;
  const publisher = r.ownerSlug && r.repoSlug
    ? `${r.ownerSlug}/${r.repoSlug}`
    : extractBaseRepo(r.repoUrl);
  return publisher ? `${publisher}/${displayName}` : displayName;
}

/**
 * Build the verified-skill.com URL for a skill.
 * Uses hierarchical slug fields (owner/repo/skill) when available,
 * falls back to flat name.
 */
export function getSkillUrl(r: SkillSearchResult): string {
  if (r.ownerSlug && r.repoSlug && r.skillSlug) {
    return `https://verified-skill.com/skills/${encodeURIComponent(r.ownerSlug)}/${encodeURIComponent(r.repoSlug)}/${encodeURIComponent(r.skillSlug)}`;
  }
  const parts = r.name.split("/");
  if (parts.length === 3) {
    return `https://verified-skill.com/skills/${parts.map(encodeURIComponent).join("/")}`;
  }
  // Fallback: derive owner/repo from repoUrl + use flat name as skill slug
  const base = extractBaseRepo(r.repoUrl);
  if (base) {
    const skillName = r.name.split("/").pop() || r.name;
    return `https://verified-skill.com/skills/${base.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(skillName)}`;
  }
  return `https://verified-skill.com/skills/${encodeURIComponent(r.name)}`;
}

/**
 * Return a colored trust badge string.
 * Prefers certTier (formal certification status shown on website)
 * over trustTier (computed trust score tier).
 */
export function getTrustBadge(certTier: string | undefined, trustTier: string | undefined): string {
  // Prefer certTier — matches what the website displays
  if (certTier === "CERTIFIED") return green("\u2713 certified");
  if (certTier === "VERIFIED") return cyan("\u2713 verified");
  // Fall back to trustTier
  switch (trustTier) {
    case "T4": return green("\u2713 certified");
    case "T3": return cyan("\u2713 verified");
    case "T2": return yellow("~ pending");
    case "T1": return dim("~ pending");
    default: return "";
  }
}

/**
 * Rank search results for display and selection.
 *
 * Sort order:
 * 1. Blocked results at end
 * 2. Exact skillSlug match (case-insensitive) promoted to first among non-blocked
 * 3. Cert tier: CERTIFIED > VERIFIED > other
 * 4. GitHub stars descending
 * 5. Score descending
 */
export function rankSearchResults(
  results: SkillSearchResult[],
  exactQuery?: string,
): SkillSearchResult[] {
  const sorted = [...results].sort((a, b) => {
    // Blocked always at end
    if (a.isBlocked && !b.isBlocked) return 1;
    if (!a.isBlocked && b.isBlocked) return -1;

    const certRank = (t: string | undefined) => t === "CERTIFIED" ? 0 : t === "VERIFIED" ? 1 : 2;
    const certDiff = certRank(a.certTier) - certRank(b.certTier);
    if (certDiff !== 0) return certDiff;

    const starDiff = (b.githubStars ?? 0) - (a.githubStars ?? 0);
    if (starDiff !== 0) return starDiff;

    return (b.score ?? 0) - (a.score ?? 0);
  });

  // Promote exact skillSlug match to first position among non-blocked
  if (exactQuery) {
    const lowerQuery = exactQuery.toLowerCase();
    const idx = sorted.findIndex(
      (r) => !r.isBlocked && r.skillSlug?.toLowerCase() === lowerQuery,
    );
    if (idx > 0) {
      const [match] = sorted.splice(idx, 1);
      sorted.unshift(match);
    }
  }

  return sorted;
}

/**
 * Format a single search result line for TTY display.
 * Matches the `vskill find` output format.
 */
export function formatResultLine(r: SkillSearchResult): string {
  const label = formatSkillId(r);
  const url = getSkillUrl(r);

  if (r.isBlocked) {
    const parts = [r.severity, r.threatType].filter(Boolean);
    const threatInfo = parts.length > 0 ? parts.join(" | ") : "blocked";
    return `${red(bold(label))}  ${red("BLOCKED")}  ${red(threatInfo)}\n  ${link(url, cyan(url))}`;
  }

  const stars = r.githubStars ?? 0;
  const starsStr = `\u2605${formatInstalls(stars)}`;
  const badge = getTrustBadge(r.certTier, r.trustTier);
  const pluginBadge = r.pluginName ? dim(` [${r.pluginName}]`) : "";
  return `${bold(label)}${pluginBadge}  ${dim(starsStr)}${badge ? "  " + badge : ""}\n  ${link(url, cyan(url))}`;
}
