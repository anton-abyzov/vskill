// ---------------------------------------------------------------------------
// Normalize various GitHub URL formats to canonical form and extract
// (owner, name) components. Ported from vskill-platform/src/lib/repo-utils.ts
// (0741 T-007). Only the pure parsing helpers needed by the FindSkillsPalette
// components are included — the network-touching `checkRepoExists()` helper
// stays platform-side.
// ---------------------------------------------------------------------------

export interface RepoInfo {
  owner: string;
  name: string;
  url: string; // canonical: https://github.com/{owner}/{name}
}

const GITHUB_URL_RE =
  /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(\.git)?(\/.*)?$/;

export function parseRepoUrl(url: string): RepoInfo | null {
  const trimmed = url.trim();
  const match = trimmed.match(GITHUB_URL_RE);
  if (!match) return null;

  const owner = match[1]?.toLowerCase();
  let name = match[2]?.toLowerCase();

  if (!owner || !name) return null;

  // Strip .git suffix (already handled by regex group but be explicit)
  name = name.replace(/\.git$/, "");

  const canonical = `https://github.com/${owner}/${name}`;
  return { owner, name, url: canonical };
}

export function normalizeRepoUrl(url: string): string | null {
  const info = parseRepoUrl(url);
  return info?.url ?? null;
}
