// ---------------------------------------------------------------------------
// 0894: fetch a GitHub skill's COMPLETE folder tree.
//
// Installs used to fetch SKILL.md plus the top level of five fixed folders,
// text extensions only, capped at 100 files, and dropped everything else
// silently (nested dirs, sub-agents/, NOTICE.md, fonts, audio). A skill whose
// SKILL.md says "run scripts/lib/x.mjs" and installs without it is broken.
//
// This lists the skill folder with ONE git-trees call (`<sha>:<dir>`,
// recursive), downloads every blob as bytes (Git LFS objects from the media
// host), keeps text as exact UTF-8 strings and binaries as raw bytes, and
// reports executable bits from the tree mode.
//
// When the folder cannot be listed (rate limit, truncated listing) or breaks
// a size limit, it degrades to the pre-0894 shape — SKILL.md plus the
// standard folders, capped — and says so in `degraded`. A download that fails
// mid-bundle is a hard error: an install never proceeds half-copied.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
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

/** Folders the degraded (pre-0894) install fetches for a skill in a subfolder. */
export const STANDARD_BUNDLE_DIRS = ["agents", "references", "scripts", "assets", "tests"] as const;

/**
 * Folders fetched for a skill whose SKILL.md sits at the repo root. There the
 * "skill folder" is the whole repository, so only the skill-authoring
 * convention folders travel with it (recursively) — not the repo's tests/.
 */
export const ROOT_SKILL_BUNDLE_DIRS = ["agents", "references", "scripts", "assets"] as const;

/** Caps of the degraded install (the pre-0894 behaviour). */
const DEGRADED_MAX_FILES = 100;
const DEGRADED_MAX_FILE_BYTES = 512 * 1024;

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
  /**
   * Set when the complete folder could not be listed or broke a limit, and
   * only SKILL.md plus the standard folders (capped) were fetched.
   */
  degraded?: string;
}

/** Hard failure: never install. */
export class SkillBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillBundleError";
  }
}

/** The complete folder is unavailable (listing or limits): degrade instead. */
class SkillBundleDegrade extends Error {}

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

type FetchImpl = NonNullable<FetchSkillBundleArgs["fetchImpl"]>;

/** Files that are never part of a skill even when committed by accident. */
const JUNK_FILES = new Set([".DS_Store", "Thumbs.db"]);

const LFS_HEADER = "version https://git-lfs.github.com/spec/v1";

function encodePath(path: string): string {
  return path.split("/").map((s) => encodeURIComponent(s)).join("/");
}

/**
 * List one folder of the repo recursively. Returns null when the folder does
 * not exist at that ref. Paths come back relative to `dir`.
 */
async function listTree(
  fetchImpl: FetchImpl,
  owner: string,
  repo: string,
  ref: string,
  dir: string,
): Promise<TreeEntry[] | null> {
  const treeish = encodeURIComponent(`${ref}:${dir}`);
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeish}?recursive=1`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } });
  } catch (err) {
    throw new SkillBundleDegrade(
      `could not list ${dir || "the skill folder"} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) {
    throw new SkillBundleDegrade(`GitHub returned ${res.status} listing ${dir || "the skill folder"}`);
  }
  const data = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  if (!Array.isArray(data.tree)) {
    throw new SkillBundleDegrade(`GitHub returned no file listing for ${dir || "the skill folder"}`);
  }
  if (data.truncated) {
    throw new SkillBundleDegrade(`GitHub truncated the file listing for ${dir || "the skill folder"}`);
  }
  return data.tree;
}

/** Pre-0894 listing: the top level of each standard folder via the Contents API. */
async function listStandardFoldersViaContents(
  fetchImpl: FetchImpl,
  owner: string,
  repo: string,
  ref: string,
  skillDir: string,
  dirs: readonly string[],
): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  for (const dir of dirs) {
    const path = skillDir ? `${skillDir}/${dir}` : dir;
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
      const res = await fetchImpl(url, { headers: { Accept: "application/vnd.github.v3+json" } });
      if (!res.ok) continue;
      const entries = (await res.json()) as Array<{ name: string; type?: string; size?: number }>;
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e.type !== "file") continue;
        out.push({ path: `${dir}/${e.name}`, mode: "100644", type: "blob", size: e.size });
      }
    } catch {
      // folder missing or API unavailable: nothing from it
    }
  }
  return out;
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

interface LfsPointer {
  oid: string;
  size: number;
}

/** Parse a Git LFS pointer file; null for anything else. */
export function parseLfsPointer(bytes: Uint8Array): LfsPointer | null {
  if (bytes.byteLength > 1024) return null;
  const text = new TextDecoder("utf-8").decode(bytes);
  if (!text.startsWith(LFS_HEADER)) return null;
  const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1];
  const size = text.match(/^size (\d+)$/m)?.[1];
  if (!oid || !size) return null;
  return { oid, size: Number(size) };
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

/** Turn tree entries into installable blobs, recording what cannot be installed. */
function collectBlobs(
  entries: TreeEntry[],
  prefix: string,
  blobs: TreeEntry[],
  skipped: GitHubSkillBundle["skipped"],
): void {
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
}

/**
 * 0894: a bundled `skill.md` / `SKILL.MD`, or two paths differing only in
 * case, would overwrite the verified SKILL.md (or each other) on a
 * case-insensitive filesystem (macOS, Windows). Refuse the skill outright.
 */
export function assertNoCaseCollisions(paths: string[]): void {
  const seen = new Map<string, string>([["skill.md", "SKILL.md"]]);
  for (const p of paths) {
    const key = p.toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined) {
      throw new SkillBundleError(
        prior === "SKILL.md"
          ? `Skill folder contains ${p}, which would overwrite SKILL.md on a case-insensitive filesystem. Nothing was installed.`
          : `Skill folder contains ${prior} and ${p}, which collide on a case-insensitive filesystem. Nothing was installed.`,
      );
    }
    seen.set(key, p);
  }
}

function checkLimits(blobs: TreeEntry[], limits: SkillBundleLimits, label: string): void {
  const fileCount = blobs.length + 1; // + SKILL.md
  if (fileCount > limits.maxFiles) {
    throw new SkillBundleDegrade(`${label} has ${fileCount} files, over the ${limits.maxFiles}-file install limit`);
  }
  const oversized = blobs.filter((b) => (b.size ?? 0) > limits.maxFileBytes);
  if (oversized.length > 0) {
    const list = oversized.slice(0, 5).map((b) => `${b.path} (${b.size} bytes)`).join(", ");
    throw new SkillBundleDegrade(
      `${label} has ${oversized.length} file(s) over the ${limits.maxFileBytes}-byte limit: ${list}`,
    );
  }
  const declaredTotal = blobs.reduce((n, b) => n + (b.size ?? 0), 0);
  if (declaredTotal > limits.maxTotalBytes) {
    throw new SkillBundleDegrade(`${label} is ${declaredTotal} bytes, over the ${limits.maxTotalBytes}-byte install limit`);
  }
}

/**
 * Fetch every file of the skill folder that holds `skillMdPath`.
 * Degrades (see `degraded`) when the folder cannot be listed or breaks a
 * limit; throws SkillBundleError on a case collision or a failed download.
 */
export async function fetchGitHubSkillBundle(args: FetchSkillBundleArgs): Promise<GitHubSkillBundle> {
  const { owner, repo, ref } = args;
  const fetchImpl = args.fetchImpl ?? githubFetch;
  const limits: SkillBundleLimits = { ...DEFAULT_SKILL_BUNDLE_LIMITS, ...args.limits };
  const skillDir = args.skillMdPath.replace(/\/?SKILL\.md$/, "");
  const label = `Skill ${skillDir || repo}`;
  const standardDirs: readonly string[] = skillDir ? STANDARD_BUNDLE_DIRS : ROOT_SKILL_BUNDLE_DIRS;

  // 1. Collect blob entries, relative to the skill folder.
  let blobs: TreeEntry[] = [];
  let skipped: GitHubSkillBundle["skipped"] = [];
  let listed: TreeEntry[] | null = null;
  let degraded: string | undefined;
  try {
    if (skillDir) {
      const entries = await listTree(fetchImpl, owner, repo, ref, skillDir);
      if (!entries) throw new SkillBundleDegrade(`folder ${skillDir} was not found at ${ref}`);
      collectBlobs(entries, "", blobs, skipped);
    } else {
      for (const dir of standardDirs) {
        const entries = await listTree(fetchImpl, owner, repo, ref, dir);
        if (entries) collectBlobs(entries, dir, blobs, skipped);
      }
    }
    listed = blobs;
    checkLimits(blobs, limits, label);
  } catch (err) {
    if (!(err instanceof SkillBundleDegrade)) throw err;
    degraded = err.message;
    // 2. Degraded install: SKILL.md plus the standard folders, capped.
    const candidates = listed
      ? listed.filter((b) => standardDirs.some((d) => b.path.startsWith(`${d}/`)))
      : await listStandardFoldersViaContents(fetchImpl, owner, repo, ref, skillDir, standardDirs);
    if (!listed) skipped = [];
    blobs = candidates
      .filter((b) => (b.size ?? 0) <= DEGRADED_MAX_FILE_BYTES)
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, DEGRADED_MAX_FILES);
  }

  assertNoCaseCollisions(blobs.map((b) => b.path));

  // 3. Download every blob as bytes. Any failure here is fatal.
  const files: Record<string, SkillBundleContent> = {};
  const failures: string[] = [];
  let totalBytes = 0;
  const refPath = encodePath(ref);
  const prefix = skillDir ? `${skillDir}/` : "";
  const download = async (url: string): Promise<{ bytes: Uint8Array | null; error: string }> => {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        return { bytes: new Uint8Array(await res.arrayBuffer()), error: "" };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return { bytes: null, error: lastError };
  };

  await mapLimit(blobs, args.concurrency ?? 8, async (b) => {
    const repoPath = encodePath(prefix + b.path);
    const got = await download(`https://raw.githubusercontent.com/${owner}/${repo}/${refPath}/${repoPath}`);
    let bytes = got.bytes;
    if (!bytes) {
      failures.push(`${b.path} (${got.error})`);
      return;
    }
    if (typeof b.size === "number" && bytes.byteLength !== b.size) {
      failures.push(`${b.path} (expected ${b.size} bytes, got ${bytes.byteLength})`);
      return;
    }
    // Git LFS: the blob is a ~130-byte pointer; the real object lives on the media host.
    const pointer = parseLfsPointer(bytes);
    if (pointer) {
      // A degraded install keeps the pre-0894 512 KB cap for LFS objects too.
      const maxFile = degraded ? Math.min(DEGRADED_MAX_FILE_BYTES, limits.maxFileBytes) : limits.maxFileBytes;
      if (pointer.size > maxFile) {
        failures.push(`${b.path} (Git LFS object of ${pointer.size} bytes is over the ${maxFile}-byte limit)`);
        return;
      }
      const lfs = await download(`https://media.githubusercontent.com/media/${owner}/${repo}/${refPath}/${repoPath}`);
      if (!lfs.bytes) {
        failures.push(`${b.path} (Git LFS object: ${lfs.error})`);
        return;
      }
      const sha = createHash("sha256").update(lfs.bytes).digest("hex");
      if (lfs.bytes.byteLength !== pointer.size || sha !== pointer.oid) {
        failures.push(`${b.path} (Git LFS object does not match its pointer)`);
        return;
      }
      bytes = lfs.bytes;
    }
    totalBytes += bytes.byteLength;
    files[b.path] = decodeText(bytes) ?? bytes;
  });

  if (failures.length > 0) {
    failures.sort();
    throw new SkillBundleError(
      `Could not download ${failures.length} of ${blobs.length} skill file(s): ${failures.slice(0, 5).join(", ")}` +
        `${failures.length > 5 ? ", ..." : ""}. Nothing was installed.`,
    );
  }

  // Git LFS objects are only sized once downloaded.
  if (!degraded && totalBytes > limits.maxTotalBytes) {
    throw new SkillBundleError(
      `${label} is ${totalBytes} bytes with its Git LFS objects, over the ${limits.maxTotalBytes}-byte install limit. Nothing was installed.`,
    );
  }

  const executables = blobs.filter((b) => b.mode === "100755").map((b) => b.path).sort();
  const fileList = ["SKILL.md", ...Object.keys(files)].sort();
  const bundle: GitHubSkillBundle = { files, executables, fileList, skipped, totalBytes };
  if (degraded) bundle.degraded = degraded;
  return bundle;
}
