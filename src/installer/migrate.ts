// ---------------------------------------------------------------------------
// Migrate stale flat .md skill files to {name}/SKILL.md subdirectory structure
// ---------------------------------------------------------------------------

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  rmSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { join, basename } from "node:path";
import { ensureFrontmatter } from "./frontmatter.js";

export interface MigrationResult {
  migratedCount: number;
  removedCount: number;
  errors: string[];
}

export interface NamingResult {
  renamedCount: number;
  errors: string[];
}

/**
 * Scan a skill directory for stale flat .md files and restructure them.
 *
 * For each `{name}.md` file found at the root level of skillsDir:
 *   1. If `{name}/SKILL.md` already exists -- delete the flat file (dedup)
 *   2. If `{name}/SKILL.md` does NOT exist -- create the subdirectory,
 *      move the content to `{name}/SKILL.md`, run ensureFrontmatter(), delete the flat file
 *
 * Also recurses one level into subdirectories (e.g., sw/) to handle
 * nested stale files like `sw/pm.md` -> `sw/pm/SKILL.md`.
 *
 * Skips: symlinks, directories, files not matching *.md, SKILL.md itself.
 */
export function migrateStaleSkillFiles(
  skillsDir: string,
): MigrationResult {
  const result: MigrationResult = {
    migratedCount: 0,
    removedCount: 0,
    errors: [],
  };

  if (!existsSync(skillsDir)) return result;

  // Process top-level stale files
  migrateDirLevel(skillsDir, result);

  // Process one level of subdirectories (e.g., sw/)
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    try {
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        migrateDirLevel(entryPath, result);
      }
    } catch {
      // Skip unreadable entries
    }
  }

  return result;
}

/** Files to skip when looking for skill content candidates. */
const SKIP_FILES = new Set([
  "README.md",
  "CHANGELOG.md",
  "LICENSE.md",
  "FRESHNESS.md",
  "PLUGIN.md",
]);

/**
 * Post-install enforcement: ensure every skill subdirectory has a SKILL.md file.
 *
 * For each subdirectory in skillsDir:
 *   - If SKILL.md already exists → skip (idempotent)
 *   - Collect .md files, excluding skip-list (README, CHANGELOG, etc.)
 *   - If candidates exist, sort alphabetically, take first → rename to SKILL.md with frontmatter
 *
 * Also recurses one level into namespace directories (e.g., sw/).
 */
export function ensureSkillMdNaming(skillsDir: string): NamingResult {
  const result: NamingResult = { renamedCount: 0, errors: [] };

  if (!existsSync(skillsDir)) return result;

  enforceSkillMdInDir(skillsDir, result);

  // Recurse one level for namespace dirs (e.g., sw/)
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry);
    try {
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        enforceSkillMdInDir(entryPath, result);
      }
    } catch {
      // Skip unreadable entries
    }
  }

  return result;
}

/**
 * Enforce SKILL.md naming in subdirectories of a single directory level.
 */
function enforceSkillMdInDir(dir: string, result: NamingResult): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    try {
      const stat = lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    // This is a skill subdirectory — check if it has SKILL.md
    const skillMdPath = join(entryPath, "SKILL.md");
    if (existsSync(skillMdPath)) continue; // Already correct

    // Look for .md candidate files to rename
    let subEntries: string[];
    try {
      subEntries = readdirSync(entryPath);
    } catch {
      continue;
    }

    const candidates = subEntries
      .filter((f) => f.endsWith(".md") && !SKIP_FILES.has(f))
      .sort();

    if (candidates.length === 0) continue;

    const winner = candidates[0];
    const winnerPath = join(entryPath, winner);

    try {
      const stat = lstatSync(winnerPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;

      const content = readFileSync(winnerPath, "utf-8");
      const skillName = basename(entryPath);
      writeFileSync(skillMdPath, ensureFrontmatter(content, skillName));
      unlinkSync(winnerPath);

      // Remove remaining non-skip .md candidates (they're duplicates)
      for (let i = 1; i < candidates.length; i++) {
        try {
          unlinkSync(join(entryPath, candidates[i]));
        } catch {
          // Non-fatal
        }
      }

      result.renamedCount++;
    } catch (err) {
      result.errors.push(
        `Failed to enforce SKILL.md in ${entryPath}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Remove stale double-nested skill directories left by pre-fix installations.
 *
 * Before the double-nesting fix (ec19dde, 2026-03-18), installing a plugin
 * whose single skill shared its name would create:
 *   {skillsDir}/{name}/{name}/SKILL.md   (incorrect)
 * instead of:
 *   {skillsDir}/{name}/SKILL.md           (correct)
 *
 * When called AFTER writing the correct SKILL.md, this function detects and
 * removes the stale nested directory.
 *
 * @param skillDir  The directory that should contain SKILL.md directly,
 *                  e.g. `~/.claude/skills/nanobanana/`
 */
export function cleanStaleNesting(skillDir: string): void {
  const name = basename(skillDir);
  const nested = join(skillDir, name);
  try {
    const stat = lstatSync(nested);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    // Only remove the nested dir when the parent already has the correct SKILL.md
    if (existsSync(join(skillDir, "SKILL.md"))) {
      rmSync(nested, { recursive: true, force: true });
    }
  } catch {
    // Nested dir doesn't exist — nothing to clean
  }
}

/**
 * Migrate stale flat .md files within a single directory level.
 */
function migrateDirLevel(dir: string, result: MigrationResult): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    // Only process .md files
    if (!entry.endsWith(".md")) continue;
    // Skip SKILL.md itself — it's not a stale file
    if (entry === "SKILL.md") continue;

    const filePath = join(dir, entry);

    try {
      const stat = lstatSync(filePath);
      // Skip symlinks
      if (stat.isSymbolicLink()) continue;
      // Skip directories (shouldn't match .md but guard anyway)
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    // Derive skill name: "frontend-design.md" -> "frontend-design"
    const skillName = basename(entry, ".md");
    const targetDir = join(dir, skillName);
    const targetSkillMd = join(targetDir, "SKILL.md");

    try {
      if (existsSync(targetSkillMd)) {
        // Both exist — remove stale flat file, preserve existing SKILL.md
        unlinkSync(filePath);
        result.removedCount++;
      } else {
        // Migrate: read content, create subdir, write SKILL.md with frontmatter
        const content = readFileSync(filePath, "utf-8");
        const withFrontmatter = ensureFrontmatter(content, skillName);
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(targetSkillMd, withFrontmatter);
        unlinkSync(filePath);
        result.migratedCount++;
      }
    } catch (err) {
      result.errors.push(
        `Failed to migrate ${filePath}: ${(err as Error).message}`,
      );
    }
  }
}
