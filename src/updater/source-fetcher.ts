// ---------------------------------------------------------------------------
// Source-aware skill fetcher for vskill update command.
// Routes fetch to the correct origin based on ParsedSource type.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDefaultBranch } from "../discovery/github-tree.js";
import { getPluginSource, getPluginVersion } from "../marketplace/index.js";
import { getSkill } from "../api/client.js";
import { findCoreSkillsDir, listCoreSkills } from "../core-skills/sync.js";
import type { ParsedSource } from "../resolvers/source-resolver.js";
import type { SkillLockEntry } from "../lockfile/types.js";
import { extractFrontmatterVersion } from "../utils/version.js";

export interface FetchResult {
  /** Skill content. For plugin-dir sources: combined content of all skills. */
  content: string;
  version: string;
  sha: string;
  tier: string;
  /** Path-to-content map of all files in this skill. */
  files?: Record<string, string>;
}

function buildAuthHeader(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  if (token) return { Authorization: `token ${token}` };
  return {};
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: buildAuthHeader() });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function normalizeContent(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

export function computeSha(content: string): string;
export function computeSha(files: Record<string, string>): string;
export function computeSha(input: string | Record<string, string>): string {
  const h = createHash("sha256");
  if (typeof input === "string") {
    h.update(normalizeContent(input));
  } else {
    const sorted = Object.keys(input).sort();
    for (const path of sorted) {
      h.update(`${path}\0${normalizeContent(input[path])}\n`);
    }
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Registry: delegate to getSkill()
// ---------------------------------------------------------------------------
async function fetchRegistry(skillName: string, entry: SkillLockEntry): Promise<FetchResult | null> {
  try {
    const remote = await getSkill(skillName);
    if (!remote.content) return null;
    const files: Record<string, string> = { "SKILL.md": remote.content };
    const sha = computeSha(files);
    return {
      content: remote.content,
      version: remote.version || entry.version,
      sha,
      tier: remote.tier || entry.tier,
      files,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub flat: fetch SKILL.md from raw.githubusercontent.com
// ---------------------------------------------------------------------------
async function fetchGitHubFlat(
  owner: string,
  repo: string,
  skillName: string,
  entry: SkillLockEntry,
): Promise<FetchResult | null> {
  const branch = await getDefaultBranch(owner, repo);
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;

  // Try skill-specific path first
  let content = await fetchRaw(`${base}/skills/${skillName}/SKILL.md`);
  // Fallback to root SKILL.md
  if (!content) {
    content = await fetchRaw(`${base}/SKILL.md`);
  }
  if (!content) return null;

  const files: Record<string, string> = { "SKILL.md": content };
  return {
    content,
    version: extractFrontmatterVersion(content) || entry.version,
    sha: computeSha(files),
    tier: entry.tier,
    files,
  };
}

// ---------------------------------------------------------------------------
// GitHub plugin / marketplace: re-fetch via marketplace.json + Trees API
// ---------------------------------------------------------------------------
async function fetchPlugin(
  owner: string,
  repo: string,
  pluginName: string,
  entry: SkillLockEntry,
): Promise<FetchResult | null> {
  const branch = await getDefaultBranch(owner, repo);
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Fetch marketplace.json
  const manifestContent = await fetchRaw(`${base}/.claude-plugin/marketplace.json`);
  if (!manifestContent) return null;

  // 2. Resolve plugin source path (e.g. "./plugins/frontend")
  const pluginSourcePath = getPluginSource(pluginName, manifestContent);
  const version = getPluginVersion(pluginName, manifestContent) ?? entry.version;
  if (!pluginSourcePath) return null;

  // Normalise: "./plugins/frontend" → "plugins/frontend"
  const normalizedPath = pluginSourcePath.replace(/^\.\//, "");

  // 3. Discover all skills under the plugin via Trees API
  let tree: Array<{ path: string; type: string }> = [];
  try {
    const treeRes = await fetch(
      `${apiBase}/git/trees/${branch}?recursive=1`,
      { headers: { Accept: "application/vnd.github.v3+json", ...buildAuthHeader() } },
    );
    if (treeRes.ok) {
      const data = (await treeRes.json()) as { tree?: unknown };
      if (Array.isArray(data?.tree)) {
        tree = data.tree as Array<{ path: string; type: string }>;
      }
    }
  } catch {
    return null;
  }

  // 4. Collect paths matching plugins/{name}/skills/*/SKILL.md
  const skillPattern = new RegExp(`^${normalizedPath}/skills/([^/]+)/SKILL\\.md$`);
  const skillPaths = tree
    .filter((e) => e.type === "blob" && skillPattern.test(e.path))
    .map((e) => e.path);

  if (skillPaths.length === 0) return null;

  // 5. Fetch all skill files in parallel
  const fetched = await Promise.all(
    skillPaths.map(async (path) => {
      const content = await fetchRaw(`${base}/${path}`);
      return { path, content };
    }),
  );

  const successful = fetched.filter((f) => f.content !== null) as Array<{ path: string; content: string }>;
  if (successful.length === 0) return null;

  // 6. Build files map and combine content (sorted by path for deterministic SHA)
  successful.sort((a, b) => a.path.localeCompare(b.path));
  const files: Record<string, string> = {};
  for (const f of successful) {
    files[f.path] = f.content;
  }
  const combined = successful.map((f) => f.content).join("\n");

  return {
    content: combined,
    version,
    sha: computeSha(files),
    tier: entry.tier,
    files,
  };
}

// ---------------------------------------------------------------------------
// Local: fetch from specweave plugin cache
// ---------------------------------------------------------------------------
function fetchLocal(skillName: string, entry: SkillLockEntry): FetchResult | null {
  const coreDir = findCoreSkillsDir();
  if (!coreDir) return null;

  // The lockfile skill name (e.g. "sw") is a plugin-level entry.
  // Find all individual skills under the plugin's skills directory.
  const skillNames = listCoreSkills(coreDir);
  if (skillNames.length === 0) return null;

  const files: Record<string, string> = {};
  for (const name of skillNames) {
    const skillDir = join(coreDir, name);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    files[`${name}/SKILL.md`] = readFileSync(skillMdPath, "utf-8");

    // Include agents/*.md if present
    const agentsDir = join(skillDir, "agents");
    if (existsSync(agentsDir) && statSync(agentsDir).isDirectory()) {
      for (const file of readdirSync(agentsDir)) {
        if (file.endsWith(".md")) {
          files[`${name}/agents/${file}`] = readFileSync(
            join(agentsDir, file),
            "utf-8",
          );
        }
      }
    }
  }

  if (Object.keys(files).length === 0) return null;

  const sha = computeSha(files);
  const combined = Object.values(files).join("\n");

  return {
    content: combined,
    version: entry.version,
    sha,
    tier: entry.tier,
    files,
  };
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------
export async function fetchFromSource(
  parsed: ParsedSource,
  skillName: string,
  entry: SkillLockEntry,
): Promise<FetchResult | null> {
  switch (parsed.type) {
    case "registry":
      return fetchRegistry(parsed.skillName, entry);

    case "github":
      return fetchGitHubFlat(parsed.owner, parsed.repo, skillName, entry);

    case "github-plugin":
      return fetchPlugin(parsed.owner, parsed.repo, parsed.pluginName, entry);

    case "marketplace":
      return fetchPlugin(parsed.owner, parsed.repo, parsed.pluginName, entry);

    case "local":
      return fetchLocal(skillName, entry);

    case "unknown":
      return null;
  }
}
