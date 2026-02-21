// ---------------------------------------------------------------------------
// GitHub Trees API skill discovery
// ---------------------------------------------------------------------------

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
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;

  let tree: Array<{ path: string; type: string }>;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) return [];
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
