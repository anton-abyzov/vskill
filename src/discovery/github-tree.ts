// ---------------------------------------------------------------------------
// GitHub Trees API skill discovery
// ---------------------------------------------------------------------------

import { yellow } from "../utils/output.js";

// ---- Rate-limit warning (deduplicated per CLI invocation) -----------------

let rateLimitWarned = false;

/** @internal Reset flag — for testing only */
export function _resetRateLimitWarned(): void {
  rateLimitWarned = false;
}

/**
 * Print a yellow warning when a GitHub API response indicates rate limiting.
 * Only prints once per CLI invocation to avoid noise.
 */
export function warnRateLimitOnce(res: Response): void {
  if (rateLimitWarned) return;
  if (res.status !== 403) return;
  if (res.headers.get("x-ratelimit-remaining") !== "0") return;
  rateLimitWarned = true;
  console.error(
    yellow("GitHub API rate limit reached. Set GITHUB_TOKEN for higher limits."),
  );
}

// ---- Branch cache ---------------------------------------------------------

/**
 * Fetch the default branch for a GitHub repo. Falls back to "main" on error.
 * Results are cached per owner/repo for the lifetime of the process.
 */
const branchCache = new Map<string, string>();

/** @internal Reset cache — for testing only */
export function _resetBranchCache(): void {
  branchCache.clear();
}

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`;
  const cached = branchCache.get(key);
  if (cached) return cached;

  let branch = "main";
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { default_branch?: string };
      branch = data.default_branch || "main";
    }
  } catch {
    // fall through with "main"
  }
  branchCache.set(key, branch);
  return branch;
}

export interface DiscoveredSkill {
  name: string;
  path: string;
  rawUrl: string;
  description?: string;
}

/**
 * Extract a short description from SKILL.md content.
 *
 * Skips: blank lines, lines starting with `#`, YAML frontmatter delimiters (`---`).
 * Returns the first content line, truncated to 80 chars.
 * Returns undefined if no content line is found.
 */
export function extractDescription(content: string): string | undefined {
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Handle YAML frontmatter
    if (trimmed === "---") {
      if (!frontmatterSeen) {
        inFrontmatter = true;
        frontmatterSeen = true;
        continue;
      } else if (inFrontmatter) {
        inFrontmatter = false;
        continue;
      }
    }
    if (inFrontmatter) continue;

    // Skip blank lines and headings
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // First real content line
    if (trimmed.length <= 80) return trimmed;
    return trimmed.slice(0, 77) + "...";
  }

  return undefined;
}

/**
 * Discover all SKILL.md files in a GitHub repo using the Trees API.
 *
 * Matches:
 *  - Root `SKILL.md` (name = repo)
 *  - `skills/{name}/SKILL.md` (name = directory name, one level deep only)
 *
 * After discovery, fetches content for each skill in parallel (3s timeout)
 * to populate the `description` field.
 *
 * Returns empty array on any API error (caller falls back to single-skill fetch).
 */
export async function discoverSkills(
  owner: string,
  repo: string,
): Promise<DiscoveredSkill[]> {
  const branch = await getDefaultBranch(owner, repo);
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  let tree: Array<{ path: string; type: string }>;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      warnRateLimitOnce(res);
      return [];
    }
    const data = (await res.json()) as { tree?: unknown };
    if (!Array.isArray(data?.tree)) return [];
    tree = data.tree as Array<{ path: string; type: string }>;
  } catch {
    return [];
  }

  const skills: DiscoveredSkill[] = [];

  for (const entry of tree) {
    if (entry.type !== "blob") continue;

    // Root SKILL.md
    if (entry.path === "SKILL.md") {
      skills.push({
        name: repo,
        path: "SKILL.md",
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/SKILL.md`,
      });
      continue;
    }

    // skills/{name}/SKILL.md (exactly one directory deep)
    // IMPORTANT: Only match skills/ directory. Never plugins/ — those are handled by installRepoPlugin.
    const match = entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (match) {
      const skillName = match[1];
      skills.push({
        name: skillName,
        path: entry.path,
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
      });
    }
  }

  // Fetch descriptions in parallel with a 3s timeout per skill
  await Promise.allSettled(
    skills.map(async (skill) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(skill.rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const content = await res.text();
        skill.description = extractDescription(content);
      } catch {
        // Timeout or network error — leave description undefined
      }
    }),
  );

  return skills;
}
