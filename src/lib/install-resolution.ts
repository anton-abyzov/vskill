// ---------------------------------------------------------------------------
// 0932: helpers for turning what the user typed into one install target.
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";

/**
 * The search results whose skill slug is exactly `query` (case-insensitive).
 * `vskill install <name> -y` only ever auto-selects one of these: a fuzzy
 * hit (sw-do -> inbox-sweep) is never installed without the user choosing it.
 */
export function exactSlugMatches(results: SkillSearchResult[], query: string): SkillSearchResult[] {
  const q = query.trim().toLowerCase();
  return results.filter((r) => (r.skillSlug ?? "").toLowerCase() === q);
}

export type ShortNamePick =
  | { kind: "pick"; result: SkillSearchResult; exact: boolean }
  | { kind: "ambiguous"; candidates: SkillSearchResult[] };

/**
 * Choose without prompting. With `--yes`, only a unique exact slug match is
 * picked; otherwise a single installable result is picked only when it is an
 * exact match. Everything else is ambiguous and goes to the prompt (TTY) or
 * exits listing the candidates.
 */
export function pickShortName(
  installable: SkillSearchResult[],
  query: string,
  opts: { yes?: boolean },
): ShortNamePick {
  const exact = exactSlugMatches(installable, query);
  if (exact.length === 1) return { kind: "pick", result: exact[0], exact: true };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };
  return { kind: "ambiguous", candidates: installable };
}

/**
 * The repo-relative folder of a marketplace plugin whose `source` is a local
 * path ("./plugins/x", "./"), or null when the source is something else (an
 * object such as `{ source: "github", repo: "..." }` pointing at another
 * repo), which a single-repo install cannot read and must skip.
 */
export function localPluginPath(source: unknown): string | null {
  if (typeof source !== "string") return null;
  return source.replace(/^\.\//, "").replace(/\/+$/, "");
}
