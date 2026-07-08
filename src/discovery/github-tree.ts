// ---------------------------------------------------------------------------
// GitHub Trees API skill discovery
// ---------------------------------------------------------------------------

import { yellow } from "../utils/output.js";
import { createGitHubFetch, githubFetch } from "../lib/github-fetch.js";

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

export type GitHubDiscoveryFailureCode =
  | "unauthorized"
  | "missing"
  | "rate_limited"
  | "transient";

export interface GitHubDiscoveryFailure {
  code: GitHubDiscoveryFailureCode;
  status?: number;
  message: string;
}

export interface GitHubDiscoveryOptions {
  /** Explicit GitHub token for tests/sandbox flows. Omit to use the CLI keychain. */
  token?: string | null;
  /** Fetch implementation for tests. Defaults to the shared GitHub fetch helper. */
  fetchImpl?: typeof fetch;
}

export interface GitHubDiscoveryResult {
  skills: DiscoveredSkill[];
  error?: GitHubDiscoveryFailure;
}

function hasOwn<K extends PropertyKey>(obj: object, key: K): obj is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function hasExplicitToken(options?: GitHubDiscoveryOptions): boolean {
  return !!options && hasOwn(options, "token") && !!options.token;
}

function githubApiHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function mergeHeaders(base: Record<string, string>, init?: HeadersInit): Record<string, string> {
  const headers = { ...base };
  if (!init) return headers;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value;
    return headers;
  }
  return { ...headers, ...(init as Record<string, string>) };
}

function branchCacheKey(owner: string, repo: string, options?: GitHubDiscoveryOptions): string {
  return `${owner}/${repo}:${hasExplicitToken(options) ? "explicit-auth" : "default-auth"}`;
}

function requestGitHub(
  url: string,
  init: RequestInit = {},
  options?: GitHubDiscoveryOptions,
): Promise<Response> {
  const headers = mergeHeaders(githubApiHeaders(options?.token), init.headers);
  const requestInit = { ...init, headers };
  if (options?.fetchImpl) return options.fetchImpl(url, requestInit);
  if (options && hasOwn(options, "token")) {
    return createGitHubFetch({
      tokenProvider: () => options.token || null,
    })(url, requestInit);
  }
  return githubFetch(url, requestInit);
}

export function classifyGitHubFailure(res: Pick<Response, "status" | "headers">): GitHubDiscoveryFailure {
  const status = res.status;
  const rateRemaining = res.headers?.get("x-ratelimit-remaining");
  if (status === 401 || (status === 403 && rateRemaining !== "0")) {
    return {
      code: "unauthorized",
      status,
      message: "GitHub authentication failed or the token lacks access to this repository.",
    };
  }
  if (status === 403 && rateRemaining === "0") {
    return {
      code: "rate_limited",
      status,
      message: "GitHub API rate limit exceeded.",
    };
  }
  if (status === 404) {
    return {
      code: "missing",
      status,
      message: "GitHub repository, branch, or skill path was not found.",
    };
  }
  if (status === 429 || status >= 500) {
    return {
      code: "transient",
      status,
      message: `GitHub returned a transient HTTP ${status} response.`,
    };
  }
  return {
    code: "transient",
    status,
    message: `GitHub returned HTTP ${status}.`,
  };
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

export async function getDefaultBranch(
  owner: string,
  repo: string,
  options?: GitHubDiscoveryOptions,
): Promise<string> {
  const key = branchCacheKey(owner, repo, options);
  const cached = branchCache.get(key);
  if (cached) return cached;

  let branch = "main";
  try {
    const res = await requestGitHub(`https://api.github.com/repos/${owner}/${repo}`, {}, options);
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

export async function getBranchHeadSha(
  owner: string,
  repo: string,
  branch: string,
  options?: GitHubDiscoveryOptions,
): Promise<string | null> {
  try {
    const res = await requestGitHub(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
      {},
      options,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: unknown };
    return typeof data.sha === "string" && data.sha ? data.sha : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a GitHub repo exists. Returns false only on 404.
 * Fails open on network errors or rate limits (returns true).
 */
export async function checkRepoExists(
  owner: string,
  repo: string,
  options?: GitHubDiscoveryOptions,
): Promise<boolean> {
  try {
    const res = await requestGitHub(`https://api.github.com/repos/${owner}/${repo}`, {}, options);
    if (res.status === 404) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Root directories that are never skills even when they contain a SKILL.md
 * (documentation, samples, build output, framework dirs). Keeps root-level
 * {name}/SKILL.md discovery from producing phantom skills.
 */
const NON_SKILL_ROOT_DIRS = new Set([
  "skills",
  "plugins",
  "docs",
  "doc",
  "examples",
  "example",
  "samples",
  "sample",
  "node_modules",
  "test",
  "tests",
  "scripts",
  "src",
  "dist",
  "build",
  "templates",
  "template",
  ".github",
]);

export interface DiscoveredSkill {
  name: string;
  path: string;
  rawUrl: string;
  description?: string;
  /** Raw URLs of agents/*.md files inside this skill directory. */
  agentRawUrls?: Record<string, string>;
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

function encodeRepoPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function fetchGitHubFileText(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  options?: GitHubDiscoveryOptions,
): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(branch)}`;
    const res = await requestGitHub(url, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/vnd.github+json" },
    }, options);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      type?: string;
      encoding?: string;
      content?: string;
      download_url?: string | null;
    } | Array<unknown>;
    if (Array.isArray(data)) return null;
    if (data.encoding === "base64" && typeof data.content === "string") {
      return Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
    }
    if (typeof data.content === "string") return data.content;
    if (data.download_url) {
      const rawRes = await requestGitHub(data.download_url, {
        signal: AbortSignal.timeout(10000),
      }, options);
      if (rawRes.ok) return await rawRes.text();
    }
  } catch {
    // File not found, timeout, or malformed GitHub payload.
  }
  return null;
}

/**
 * Discover all SKILL.md files in a GitHub repo using the Trees API.
 *
 * Matches:
 *  - Root `SKILL.md` (name = repo)
 *  - `skills/{name}/SKILL.md` (name = directory name, one level deep only)
 *  - `plugins/{non-specweave}/skills/{name}/SKILL.md` (non-framework plugin skills)
 *
 * After discovery, fetches content for each skill in parallel (3s timeout)
 * to populate the `description` field.
 *
 * Returns empty array on any API error (caller falls back to single-skill fetch).
 */
export async function discoverSkills(
  owner: string,
  repo: string,
  options?: GitHubDiscoveryOptions,
): Promise<DiscoveredSkill[]> {
  const result = await discoverSkillsDetailed(owner, repo, options);
  return result.skills;
}

export async function discoverSkillsDetailed(
  owner: string,
  repo: string,
  options?: GitHubDiscoveryOptions,
): Promise<GitHubDiscoveryResult> {
  const branch = await getDefaultBranch(owner, repo, options);
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

  let tree: Array<{ path: string; type: string }>;
  try {
    const res = await requestGitHub(url, {}, options);
    if (!res.ok) {
      warnRateLimitOnce(res);
      return { skills: [], error: classifyGitHubFailure(res) };
    }
    const data = (await res.json()) as { tree?: unknown };
    if (!Array.isArray(data?.tree)) return { skills: [] };
    tree = data.tree as Array<{ path: string; type: string }>;
  } catch {
    return {
      skills: [],
      error: {
        code: "transient",
        message: "Failed to connect to GitHub.",
      },
    };
  }

  const skills: DiscoveredSkill[] = [];
  // Collect agents/*.md paths per skill for a second pass
  const agentFilesBySkill = new Map<string, Record<string, string>>();

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
    const match = entry.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (match) {
      const skillName = match[1];
      // If already discovered via plugins/, replace (skills/ takes priority)
      const idx = skills.findIndex((s) => s.name === skillName);
      const newSkill: DiscoveredSkill = {
        name: skillName,
        path: entry.path,
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
      };
      if (idx >= 0) {
        skills[idx] = newSkill;
      } else {
        skills.push(newSkill);
      }
      continue;
    }

    // {name}/SKILL.md — root-level skill directories (e.g. higgsfield-ai/skills
    // keeps each skill as a top-level folder). Lower priority than skills/{name}:
    // never overwrites an existing entry, and skills/{name} replaces it later.
    // Common non-skill directories are excluded so docs/examples layouts don't
    // produce phantom skills.
    const rootDirMatch = entry.path.match(/^([^/]+)\/SKILL\.md$/);
    if (rootDirMatch) {
      const skillName = rootDirMatch[1];
      if (
        !NON_SKILL_ROOT_DIRS.has(skillName.toLowerCase()) &&
        !skills.some((s) => s.name === skillName)
      ) {
        skills.push({
          name: skillName,
          path: entry.path,
          rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
        });
      }
      continue;
    }

    // plugins/{non-specweave}/skills/{name}/SKILL.md — non-framework plugin skills
    const pluginMatch = entry.path.match(
      /^plugins\/(?!specweave)[^/]+\/skills\/([^/]+)\/SKILL\.md$/,
    );
    if (pluginMatch) {
      const skillName = pluginMatch[1];
      skills.push({
        name: skillName,
        path: entry.path,
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`,
      });
      continue;
    }

    // skills/{name}/agents/*.md — collect for attachment to parent skill
    const agentMatch = entry.path.match(/^skills\/([^/]+)\/agents\/([^/]+\.md)$/);
    if (agentMatch) {
      const skillName = agentMatch[1];
      const agentFilename = agentMatch[2];
      let map = agentFilesBySkill.get(skillName);
      if (!map) {
        map = {};
        agentFilesBySkill.set(skillName, map);
      }
      map[`agents/${agentFilename}`] = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`;
    }

    // {name}/agents/*.md — agent files for root-level skill directories
    const rootAgentMatch = entry.path.match(/^([^/]+)\/agents\/([^/]+\.md)$/);
    if (rootAgentMatch && !NON_SKILL_ROOT_DIRS.has(rootAgentMatch[1].toLowerCase())) {
      const skillName = rootAgentMatch[1];
      const agentFilename = rootAgentMatch[2];
      let map = agentFilesBySkill.get(skillName);
      if (!map) {
        map = {};
        agentFilesBySkill.set(skillName, map);
      }
      map[`agents/${agentFilename}`] = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`;
      continue;
    }

    // plugins/{non-specweave}/skills/{name}/agents/*.md — plugin agent files
    const pluginAgentMatch = entry.path.match(
      /^plugins\/(?!specweave)[^/]+\/skills\/([^/]+)\/agents\/([^/]+\.md)$/,
    );
    if (pluginAgentMatch) {
      const skillName = pluginAgentMatch[1];
      const agentFilename = pluginAgentMatch[2];
      let map = agentFilesBySkill.get(skillName);
      if (!map) {
        map = {};
        agentFilesBySkill.set(skillName, map);
      }
      map[`agents/${agentFilename}`] = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`;
    }
  }

  // Attach agent raw URLs to their parent skills
  for (const skill of skills) {
    const urls = agentFilesBySkill.get(skill.name);
    if (urls) skill.agentRawUrls = urls;
  }

  // Fetch descriptions in parallel with a 3s timeout per skill
  await Promise.allSettled(
    skills.map(async (skill) => {
      try {
        let content: string | null = null;
        if (hasExplicitToken(options)) {
          content = await fetchGitHubFileText(owner, repo, branch, skill.path, options);
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          try {
            const res = await requestGitHub(skill.rawUrl, { signal: controller.signal }, options);
            if (res.ok) content = await res.text();
          } finally {
            clearTimeout(timer);
          }
        }
        if (!content) return;
        skill.description = extractDescription(content);
      } catch {
        // Timeout or network error — leave description undefined
      }
    }),
  );

  return { skills };
}
