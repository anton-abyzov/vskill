import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep as pathSep } from "node:path";

const STANDARD_BUNDLE_PREFIXES = [
  "agents/",
  "scripts/",
  "references/",
  "assets/",
  "tests/",
] as const;

const STANDARD_ROOT_FILES = new Set([".env.example"]);

function normalizeBundlePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function isStandardBundlePath(relPath: string): boolean {
  return (
    STANDARD_ROOT_FILES.has(relPath) ||
    STANDARD_BUNDLE_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

export interface BundlePathOptions {
  /**
   * 0894: accept any relative path inside the skill folder (sub-agents/,
   * NOTICE.md, modes/x/README.md, ...), not only the standard folders. Used
   * for complete skill trees fetched from the skill's own repository; the
   * traversal and SKILL.md checks still apply.
   */
  anyPath?: boolean;
}

/** 0894: bundle file content: text, or raw bytes for binaries (fonts, audio). */
export type BundleContent = string | Uint8Array;

export function assertSafeBundlePath(relPath: string, opts: BundlePathOptions = {}): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new Error("Bundled skill file path cannot be empty");
  }
  if (relPath.includes("\0")) {
    throw new Error(`Bundled skill file path contains a NUL byte: ${relPath}`);
  }

  const normalized = normalizeBundlePath(relPath.trim());
  // 0894: case-insensitive — a bundled skill.md would overwrite the verified
  // SKILL.md on macOS/Windows filesystems.
  if (normalized.toLowerCase() === "skill.md") {
    throw new Error(`Bundled skill files must not include SKILL.md (got ${relPath})`);
  }
  if (isAbsolute(normalized) || normalized.startsWith("/")) {
    throw new Error(`Bundled skill file path must be relative: ${relPath}`);
  }

  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Bundled skill file path escapes the skill directory: ${relPath}`);
  }
  if (!opts.anyPath && !isStandardBundlePath(normalized)) {
    throw new Error(
      `Unsupported bundled skill file path: ${relPath}. Expected agents/, scripts/, references/, assets/, tests/, or .env.example`,
    );
  }
  return normalized;
}

export function resolveBundleTarget(
  root: string,
  relPath: string,
  opts: BundlePathOptions = {},
): string {
  const normalized = assertSafeBundlePath(relPath, opts);
  const target = join(root, ...normalized.split("/"));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + pathSep) || rel.startsWith("../")) {
    throw new Error(`Bundled skill file path escapes install root: ${relPath}`);
  }
  return target;
}

export function sanitizeSkillBundleFiles(files: unknown): Record<string, string> {
  if (files === undefined || files === null) return {};
  if (typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Bundled skill files must be an object keyed by relative path");
  }

  const out: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(files as Record<string, unknown>)) {
    const relPath = assertSafeBundlePath(rawPath);
    if (typeof content !== "string") {
      throw new Error(`Bundled skill file ${rawPath} must have string content`);
    }
    out[relPath] = content;
  }
  return out;
}

/**
 * 0894: validate a complete skill tree fetched from GitHub for the CLI
 * install path. Any safe relative path is accepted and binary content stays
 * raw bytes. (Studio requests keep the stricter sanitizeSkillBundleFiles.)
 */
export function sanitizeInstallBundleFiles(
  files: Record<string, BundleContent>,
): Record<string, BundleContent> {
  const out: Record<string, BundleContent> = {};
  const seen = new Map<string, string>();
  for (const [rawPath, content] of Object.entries(files)) {
    const relPath = assertSafeBundlePath(rawPath, { anyPath: true });
    // Two paths differing only in case overwrite each other on macOS/Windows.
    const key = relPath.toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined) {
      throw new Error(`Bundled skill files ${prior} and ${relPath} collide on a case-insensitive filesystem`);
    }
    seen.set(key, relPath);
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      throw new Error(`Bundled skill file ${rawPath} must be text or bytes`);
    }
    out[relPath] = content;
  }
  return out;
}

/**
 * 0894: the subset of an install bundle that the string-only consumers
 * (Tier-2 transformers, clipboard export) can carry: text files on the
 * standard paths.
 */
export function textOnlyStandardBundle(
  files: Record<string, BundleContent>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(files)) {
    if (typeof content !== "string") continue;
    try {
      out[assertSafeBundlePath(relPath)] = content;
    } catch {
      // non-standard path: written by Tier-1 installs only
    }
  }
  return out;
}

export async function collectSkillBundleFiles(skillDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walk(dir: string, relBase = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const normalized = normalizeBundlePath(relPath);
        if (STANDARD_BUNDLE_PREFIXES.some((prefix) => prefix.startsWith(`${normalized}/`) || normalized.startsWith(prefix))) {
          await walk(absPath, normalized);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (relPath === "SKILL.md") continue;

      let safePath: string;
      try {
        safePath = assertSafeBundlePath(relPath);
      } catch {
        continue;
      }
      files[safePath] = await fs.readFile(absPath, "utf-8");
    }
  }

  await walk(skillDir);
  return files;
}
