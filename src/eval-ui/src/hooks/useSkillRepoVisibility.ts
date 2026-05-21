/**
 * 0848 — Resolve a skill's source-repo visibility (public/private/unknown).
 *
 * Skill metadata carries `repoUrl` (e.g. `https://github.com/owner/name`) but
 * not `isPrivate`. The connected-repos API (used by the account cabinet) does
 * carry `isPrivate` per repo. We join them client-side so the Sidebar +
 * MarketplaceDrawer can render a privacy chip without a schema change.
 *
 * Returns `"unknown"` (not `"public"`) when no match is found — public-repo
 * skills installed via the public registry are not in the connected-repos
 * list, but we don't want to lie and say `"public"` when we genuinely don't
 * know. UI treats `"unknown"` the same as `"public"` (no chip).
 */
import { useMemo } from "react";

import { reposArray, useConnectedRepos } from "./useAccount";
import type { ConnectedRepoDTO } from "../types/account";

export type RepoVisibility = "public" | "private" | "unknown";

const HTTPS_HOST_PATH = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i;
const SSH_PATH = /^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?$/i;

/**
 * Extract `owner/name` (lowercased) from a wide variety of GitHub URLs.
 * Returns `null` for non-GitHub URLs or unparseable strings.
 */
export function parseGithubRepoSlug(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;
  const trimmed = repoUrl.trim();
  const httpsMatch = HTTPS_HOST_PATH.exec(trimmed);
  if (httpsMatch) return `${httpsMatch[1].toLowerCase()}/${httpsMatch[2].toLowerCase()}`;
  const sshMatch = SSH_PATH.exec(trimmed);
  if (sshMatch) return `${sshMatch[1].toLowerCase()}/${sshMatch[2].toLowerCase()}`;
  return null;
}

/**
 * Build a (lowercased) `owner/name` → ConnectedRepoDTO lookup map.
 * Memoize at the caller via useMemo to avoid rebuilding per row.
 */
export function buildConnectedRepoLookup(
  repos: ReadonlyArray<ConnectedRepoDTO>,
): Map<string, ConnectedRepoDTO> {
  const map = new Map<string, ConnectedRepoDTO>();
  for (const repo of repos) {
    map.set(repo.repoFullName.toLowerCase(), repo);
  }
  return map;
}

export interface ResolvedRepoVisibility {
  visibility: RepoVisibility;
  /** The matched repo row (when visibility !== "unknown"). */
  repo: ConnectedRepoDTO | null;
}

/**
 * Look up a skill's repo in the connected-repos list. Pure — no React state.
 * Use this inside list renderers that already hold the lookup map; use
 * `useSkillRepoVisibility` from a single-row consumer.
 */
export function resolveSkillRepoVisibility(
  repoUrl: string | null | undefined,
  lookup: Map<string, ConnectedRepoDTO>,
): ResolvedRepoVisibility {
  const slug = parseGithubRepoSlug(repoUrl);
  if (!slug) return { visibility: "unknown", repo: null };
  const match = lookup.get(slug);
  if (!match) return { visibility: "unknown", repo: null };
  return { visibility: match.isPrivate ? "private" : "public", repo: match };
}

/**
 * Hook variant — fetches connected repos and resolves visibility for one URL.
 * Components rendering many rows should build the lookup map once via
 * `buildConnectedRepoLookup` and call `resolveSkillRepoVisibility` per row
 * to avoid N copies of the SWR subscription.
 */
export function useSkillRepoVisibility(
  repoUrl: string | null | undefined,
): ResolvedRepoVisibility {
  const { data } = useConnectedRepos();
  const lookup = useMemo(
    () => buildConnectedRepoLookup(reposArray(data)),
    [data],
  );
  return resolveSkillRepoVisibility(repoUrl, lookup);
}

/**
 * Hook variant for list renderers — returns the lookup map alongside the
 * raw connected-repos list so callers can call `resolveSkillRepoVisibility`
 * for each row without re-subscribing to SWR per row.
 */
export function useConnectedRepoLookup(): {
  lookup: Map<string, ConnectedRepoDTO>;
  repos: ReadonlyArray<ConnectedRepoDTO>;
  loading: boolean;
  privateCount: number;
  publicCount: number;
} {
  const { data, loading } = useConnectedRepos();
  const repos = reposArray(data);
  const lookup = useMemo(() => buildConnectedRepoLookup(repos), [repos]);
  return {
    lookup,
    repos,
    loading: !!loading,
    privateCount: data?.privateCount ?? repos.filter((r) => r.isPrivate).length,
    publicCount: data?.publicCount ?? repos.filter((r) => !r.isPrivate).length,
  };
}
