/**
 * File discovery for local project auditing.
 *
 * Walks the filesystem to find scannable files, respecting
 * configurable exclude patterns, max file limits, and binary detection.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, extname, relative } from "node:path";
import type { AuditConfig, AuditFile } from "./audit-types.js";

/** Extensions considered scannable for security auditing */
const SCANNABLE_EXTENSIONS = new Set([
  ".md", ".json", ".yaml", ".yml", ".toml",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".lua", ".go", ".rs", ".java",
  ".php", ".cs", ".c", ".cpp", ".h", ".hpp",
  ".swift", ".kt", ".kts", ".scala",
  ".sql", ".graphql", ".gql",
  ".env", ".ini", ".cfg", ".conf",
  ".xml", ".html", ".htm", ".vue", ".svelte",
]);

/** Directories to always skip */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".next", ".nuxt", ".output", "__pycache__", ".pytest_cache",
  "vendor", ".venv", "venv", ".tox",
  ".idea", ".vscode",
  "target", // Rust/Java
]);

/**
 * Check if a buffer contains binary content (null byte in first 8KB).
 */
function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Check if a file path is scannable based on its extension.
 */
function isScannable(filePath: string): boolean {
  const name = basename(filePath);
  const ext = extname(name).toLowerCase();
  return ext !== "" && SCANNABLE_EXTENSIONS.has(ext);
}

/**
 * Simple glob pattern matching for exclude paths.
 * Supports ** (any path) and * (any segment).
 */
function matchesExcludePattern(
  relativePath: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    const regex = patternToRegex(pattern);
    if (regex.test(relativePath)) return true;
  }
  return false;
}

function patternToRegex(pattern: string): RegExp {
  // Normalize: **/X means "anywhere/X" including at root
  let p = pattern;
  // Handle leading **/ — matches zero or more directories
  if (p.startsWith("**/")) {
    p = p.slice(3);
    const inner = globSegmentToRegex(p);
    return new RegExp(`^(?:.*\\/)?${inner}$`);
  }
  return new RegExp(`^${globSegmentToRegex(p)}$`);
}

function globSegmentToRegex(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
}

/**
 * Discover files in a directory or single file for auditing.
 *
 * @param targetPath - Path to a directory or single file
 * @param config - Audit configuration with exclude patterns and limits
 * @returns Array of discovered AuditFile objects
 */
export async function discoverAuditFiles(
  targetPath: string,
  config: AuditConfig,
): Promise<AuditFile[]> {
  const targetStat = await stat(targetPath);

  // Single file mode
  if (targetStat.isFile()) {
    const content = await readFile(targetPath, "utf-8");
    return [
      {
        path: basename(targetPath),
        content,
        sizeBytes: targetStat.size,
      },
    ];
  }

  // Directory mode
  const files: AuditFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= config.maxFiles) return;

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= config.maxFiles) break;

      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(targetPath, fullPath);

      if (entry.isDirectory()) {
        // Skip known non-useful directories
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        // Check exclude patterns
        if (matchesExcludePattern(relativePath, config.excludePaths)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (!isScannable(relativePath)) continue;
        if (matchesExcludePattern(relativePath, config.excludePaths)) continue;

        try {
          const fileStat = await stat(fullPath);

          // Skip files exceeding size limit
          if (fileStat.size > config.maxFileSize) continue;

          const buffer = await readFile(fullPath);
          if (isBinary(buffer)) continue;

          const content = buffer.toString("utf-8");
          files.push({
            path: relativePath,
            content,
            sizeBytes: fileStat.size,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(targetPath);
  return files;
}
