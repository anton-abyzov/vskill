// ---------------------------------------------------------------------------
// GitHub Trees API skill discovery
// ---------------------------------------------------------------------------

export interface DiscoveredSkill {
  name: string;
  path: string;
  rawUrl: string;
}

/**
 * Discover all SKILL.md files in a GitHub repo using the Trees API.
 *
 * Matches:
 *  - Root `SKILL.md` (name = repo)
 *  - `skills/{name}/SKILL.md` (name = directory name, one level deep only)
 *
 * Returns empty array on any API error (caller falls back to single-skill fetch).
 */
export async function discoverSkills(
  owner: string,
  repo: string,
): Promise<DiscoveredSkill[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;

  let tree: Array<{ path: string; type: string }>;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tree: Array<{ path: string; type: string }> };
    tree = data.tree;
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
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`,
      });
      continue;
    }

    // skills/{name}/SKILL.md (exactly one directory deep)
    const match = entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (match) {
      const skillName = match[1];
      skills.push({
        name: skillName,
        path: entry.path,
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${entry.path}`,
      });
    }
  }

  return skills;
}
