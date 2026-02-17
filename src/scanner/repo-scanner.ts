/**
 * Full-repository scanning.
 *
 * Shallow-clones a git repository, discovers relevant files,
 * and runs Tier 1 scanning across the entire repo.
 */

import { simpleGit } from 'simple-git';
import { readdir, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RepoFile, ScanResult, SecurityFinding } from './types.js';
import { runTier1Scan } from './tier1.js';

/** Maximum file size in bytes (100 KB) */
const MAX_FILE_SIZE = 100 * 1024;

/** Maximum total content size in bytes (1 MB) */
const MAX_TOTAL_SIZE = 1024 * 1024;

/** File extensions and names to include in scanning */
const SCANNABLE_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.lua',
]);

/** Directory names that are always relevant for scanning */
const SCANNABLE_DIRS = new Set(['scripts', 'hooks', 'commands', 'skills', 'src']);

/** Files that should always be scanned regardless of extension */
const ALWAYS_SCAN = new Set([
  'SKILL.md',
  'CLAUDE.md',
  'AGENTS.md',
  'package.json',
  'tsconfig.json',
  'Makefile',
  'Dockerfile',
]);

/**
 * Performs a shallow clone of a git repository.
 *
 * @param repoUrl - The git repository URL (HTTPS or SSH)
 * @param tmpDir - Directory to clone into
 * @returns Path to the cloned repository
 */
export async function shallowClone(repoUrl: string, tmpDir: string): Promise<string> {
  const git = simpleGit();
  await git.clone(repoUrl, tmpDir, ['--depth=1', '--single-branch']);
  return tmpDir;
}

/**
 * Checks if a buffer likely contains binary content (null byte check).
 */
function isBinary(buffer: Buffer): boolean {
  // Check for null bytes in the first 8KB
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Determines if a file should be scanned based on its path.
 */
function isScannable(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? '';

  // Always scan certain files
  if (ALWAYS_SCAN.has(fileName)) return true;

  // Check extension
  const extIndex = fileName.lastIndexOf('.');
  if (extIndex >= 0) {
    const ext = fileName.slice(extIndex).toLowerCase();
    if (SCANNABLE_EXTENSIONS.has(ext)) return true;
  }

  return false;
}

/**
 * Recursively discovers all non-binary, scannable files in a directory.
 *
 * @param dir - Root directory to scan
 * @param basePath - Base path for relative path computation
 * @returns Array of RepoFile objects
 */
export async function discoverFiles(dir: string, basePath?: string): Promise<RepoFile[]> {
  const root = basePath ?? dir;
  const files: RepoFile[] = [];
  let totalSize = 0;

  async function walk(currentDir: string): Promise<void> {
    if (totalSize >= MAX_TOTAL_SIZE) return;

    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (totalSize >= MAX_TOTAL_SIZE) break;

      const fullPath = join(currentDir, entry.name);
      const relativePath = fullPath.slice(root.length + 1);

      if (entry.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (!isScannable(relativePath)) continue;

        try {
          const fileStat = await stat(fullPath);

          // Skip files that are too large
          if (fileStat.size > MAX_FILE_SIZE) continue;
          if (totalSize + fileStat.size > MAX_TOTAL_SIZE) continue;

          const buffer = await readFile(fullPath);

          // Skip binary files
          if (isBinary(buffer)) continue;

          const content = buffer.toString('utf-8');
          totalSize += fileStat.size;

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

  await walk(dir);
  return files;
}

/**
 * Clones a repository, discovers files, and scans them all.
 *
 * @param repoUrl - The git repository URL
 * @returns Combined ScanResult for all discovered files
 */
export async function scanRepository(repoUrl: string): Promise<ScanResult> {
  // Create a temporary directory for the clone
  const tmpDir = await mkdtemp(join(tmpdir(), 'vskill-scan-'));

  try {
    // Shallow clone
    await shallowClone(repoUrl, tmpDir);

    // Discover files
    const files = await discoverFiles(tmpDir);

    // Scan all files and aggregate results
    const allFindings: SecurityFinding[] = [];
    for (const file of files) {
      const result = runTier1Scan(file.content);
      for (const f of result.findings) {
        allFindings.push({
          severity: f.severity,
          category: f.category,
          message: `[${file.path}] ${f.patternName}: ${f.match}`,
          line: f.lineNumber,
        });
      }
    }
    const passed = !allFindings.some(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    return { passed, findings: allFindings };
  } finally {
    // Clean up temporary directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup
    });
  }
}
