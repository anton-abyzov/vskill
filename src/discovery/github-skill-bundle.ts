// ---------------------------------------------------------------------------
// 0894: fetch a GitHub skill's COMPLETE folder tree.
//
// Installs used to fetch SKILL.md plus the top level of five fixed folders,
// text extensions only, capped at 100 files, and dropped everything else
// silently (nested dirs, sub-agents/, NOTICE.md, fonts, audio). A skill whose
// SKILL.md says "run scripts/lib/x.mjs" and installs without it is broken.
//
// This lists the skill folder with ONE git-trees call (`<ref>:<dir>`,
// recursive), downloads every blob as bytes, keeps text as exact UTF-8
// strings and binaries as raw bytes, reports executable bits from the tree
// mode, and throws instead of truncating when a limit is exceeded.
// ---------------------------------------------------------------------------

import { githubFetch } from "../lib/github-fetch.js";

export type SkillBundleContent = string | Uint8Array;

export interface SkillBundleLimits {
  /** Most files a skill may carry (SKILL.md included). */
  maxFiles: number;
  /** Largest single file, in bytes. */
  maxFileBytes: number;
  /** Largest whole skill, in bytes. */
  maxTotalBytes: number;
}

export const DEFAULT_SKILL_BUNDLE_LIMITS: SkillBundleLimits = {
  maxFiles: 1000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
};

/**
 * Folders fetched for a skill whose SKILL.md sits at the repo root. There the
 * "skill folder" is the whole repository, so only the skill-authoring
 * convention folders travel with it (recursively).
 */
export const ROOT_SKILL_BUNDLE_DIRS = ["agents", "references", "scripts", "assets", "tests"] as const;

export interface GitHubSkillBundle {
  /** Every file except the top-level SKILL.md, keyed by path relative to the skill folder. */
  files: Record<string, SkillBundleContent>;
  /** Relative paths whose git mode is 100755. */
  executables: string[];
  /** Sorted relative paths of everything installed, SKILL.md included. */
  fileList: string[];
  /** Entries that cannot be installed as files (symlinks, submodules). */
  skipped: Array<{ path: string; reason: string }>;
  /** Bytes downloaded (SKILL.md excluded). */
  totalBytes: number;
}

export class SkillBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillBundleError";
  }
}

export interface FetchSkillBundleArgs {
  owner: string;
  repo: string;
  /** Commit SHA (preferred) or branch the files are read from. */
  ref: string;
  /** Repo-relative path of the skill's SKILL.md. */
  skillMdPath: string;
  limits?: Partial<SkillBundleLimits>;
  /** Parallel downloads. */
  concurrency?: number;
  /** Injected for tests; defaults to the shared authenticated GitHub fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  size?: number;
}

/** Files that are never part of a skill even when committed by accident. */
const JUNK_FILES = new Set([".DS_Store", "Thumbs.db"]);

function encodePath(path: string): string {
  return path.split("/").map((s) => encodeURIComponent(s)).join("/");
}

/**
 * List one folder of the repo recursively. Returns null when the folder does
 * not exist at that ref. Paths come back relative to `dir`.
 */
async function listTree(
  fetchImpl: NonNullable<FetchSkillBundleArgs["fetchImpl"]>,
  owner: string,
  repo: string,
  ref: string,
  dir: string,
): Promise<TreeEntry[] | null> {
  const treeish = encodeURIComponent(`${ref}:${dir}`);
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeish}?recursive=1`;
  const res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) {
    throw new SkillBundleError(
      `Could not list ${dir || "the skill folder"} in ${owner}/${repo}@${ref}: GitHub returned ${res.status}.`,
    );
  }
  const data = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  if (!Array.isArray(data.tree)) {
    throw new SkillBundleError(`GitHub returned no tree for ${owner}/${repo}@${ref}:${dir}.`);
  }
  if (data.truncated) {
    throw new SkillBundleError(
      `GitHub truncated the file listing for ${owner}/${repo}/${dir}; refusing to install a partial skill.`,
    );
  }
  return data.tree;
}

/** True for content that is valid UTF-8 without NUL bytes. */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    // ignoreBOM keeps a leading BOM so the string round-trips byte for byte.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Fetch every file of the skill folder that holds `skillMdPath`.
 * Throws SkillBundleError on a limit breach, a truncated listing, or any
 * file that cannot be downloaded — an install never proceeds half-copied.
 */
export async function fetchGitHubSkillBundle(args: FetchSkillBundleArgs): Promise<GitHubSkillBundle> {
  const { owner, repo, ref } = args;
  const fetchImpl = args.fetchImpl ?? githubFetch;
  const limits: SkillBundleLimits = { ...DEFAULT_SKILL_BUNDLE_LIMITS, ...args.limits };
  const skillDir = args.skillMdPath.replace(/\/?SKILL\.md$/, "");

  // 1. Collect blob entries, relative to the skill folder.
  const blobs: TreeEntry[] = [];
  const skipped: GitHubSkillBundle["skipped"] = [];
  const collect = (entries: TreeEntry[], prefix: string) => {
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.path}` : e.path;
      if (e.type === "tree") continue;
      if (e.type === "commit") {
        skipped.push({ path: rel, reason: "git submodule" });
        continue;
      }
      if (e.type !== "blob") continue;
      if (e.mode === "120000") {
        skipped.push({ path: rel, reason: "symbolic link" });
        continue;
      }
      const base = rel.split("/").pop()!;
      if (JUNK_FILES.has(base)) continue;
      if (rel === "SKILL.md") continue; // fetched and scanned by the caller
      blobs.push({ ...e, path: rel });
    }
  };

  if (skillDir) {
    const entries = await listTree(fetchImpl, owner, repo, ref, skillDir);
    if (!entries) {
      throw new SkillBundleError(`Skill folder ${skillDir} not found in ${owner}/${repo}@${ref}.`);
    }
    collect(entries, "");
  } else {
    for (const dir of ROOT_SKILL_BUNDLE_DIRS) {
      const entries = await listTree(fetchImpl, owner, repo, ref, dir);
      if (entries) collect(entries, dir);
    }
  }

  // 2. Enforce limits BEFORE downloading anything.
  const fileCount = blobs.length + 1; // + SKILL.md
  if (fileCount > limits.maxFiles) {
    throw new SkillBundleError(
      `Skill ${skillDir || repo} has ${fileCount} files, over the ${limits.maxFiles}-file install limit. Nothing was installed.`,
    );
  }
  const oversized = blobs.filter((b) => (b.size ?? 0) > limits.maxFileBytes);
  if (oversized.length > 0) {
    const list = oversized.slice(0, 5).map((b) => `${b.path} (${b.size} bytes)`).join(", ");
    throw new SkillBundleError(
      `Skill ${skillDir || repo} has ${oversized.length} file(s) over the ${limits.maxFileBytes}-byte limit: ${list}. Nothing was installed.`,
    );
  }
  const declaredTotal = blobs.reduce((n, b) => n + (b.size ?? 0), 0);
  if (declaredTotal > limits.maxTotalBytes) {
    throw new SkillBundleError(
      `Skill ${skillDir || repo} is ${declaredTotal} bytes, over the ${limits.maxTotalBytes}-byte install limit. Nothing was installed.`,
    );
  }

  // 3. Download every blob as bytes.
  const files: Record<string, SkillBundleContent> = {};
  const failures: string[] = [];
  let totalBytes = 0;
  const refPath = encodePath(ref);
  const prefix = skillDir ? `${skillDir}/` : "";
  await mapLimit(blobs, args.concurrency ?? 8, async (b) => {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${refPath}/${encodePath(prefix + b.path)}`;
    let bytes: Uint8Array | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 2 && !bytes; attempt++) {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (!bytes) {
      failures.push(`${b.path} (${lastError})`);
      return;
    }
    if (typeof b.size === "number" && bytes.byteLength !== b.size) {
      failures.push(`${b.path} (expected ${b.size} bytes, got ${bytes.byteLength})`);
      return;
    }
    totalBytes += bytes.byteLength;
    const text = decodeText(bytes);
    files[b.path] = text ?? bytes;
  });

  if (failures.length > 0) {
    failures.sort();
    throw new SkillBundleError(
      `Could not download ${failures.length} of ${blobs.length} skill file(s): ${failures.slice(0, 5).join(", ")}` +
        `${failures.length > 5 ? ", ..." : ""}. Nothing was installed.`,
    );
  }

  const executables = blobs.filter((b) => b.mode === "100755").map((b) => b.path).sort();
  const fileList = ["SKILL.md", ...Object.keys(files)].sort();
  return { files, executables, fileList, skipped, totalBytes };
}

/** Text files of a bundle, for the security scan (binaries pass through). */
export function bundleTextFiles(files: Record<string, SkillBundleContent>): Array<[string, string]> {
  return Object.entries(files)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b));
}
