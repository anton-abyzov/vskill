// ---------------------------------------------------------------------------
// copyPluginFiltered — shared plugin-to-target copy helper
// ---------------------------------------------------------------------------
// Lifted from src/commands/add.ts so both the `vskill add` command and the
// studio scope-transfer routes (src/studio/routes/*) can consume one
// implementation without creating a commands/ → studio/ dependency.
// ---------------------------------------------------------------------------

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join, basename } from "node:path";
import { ensureFrontmatter } from "../installer/frontmatter.js";

/**
 * Returns true for .md files that should NOT be installed into an agent's
 * commands directory. Claude Code (and similar agents) register every .md
 * file they find recursively as a slash command, so plugin-internal files
 * must be excluded.
 */
export function shouldSkipFromCommands(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1];

  if (!filename.endsWith(".md")) return false;
  if (parts.length === 1 && filename === "PLUGIN.md") return true;
  if (filename === "README.md") return true;
  if (filename === "FRESHNESS.md") return true;

  if (parts.length > 1 && parts[0].startsWith(".")) return true;

  const internalRootDirs = new Set(["knowledge-base", "lib", "templates", "scripts", "hooks"]);
  if (parts.length > 1 && internalRootDirs.has(parts[0])) return true;

  if (parts[0] === "skills" && parts.length > 2 && filename !== "SKILL.md") {
    // Allow agents/*.md files inside skill directories (skills/{name}/agents/*.md)
    if (parts[2] === "agents" && filename.endsWith(".md")) return false;
    return true;
  }

  return false;
}

/** Skip-list of .md files that are documentation, not skill content. */
const COPY_SKIP_MD = new Set(["README.md", "CHANGELOG.md", "LICENSE.md", "FRESHNESS.md", "PLUGIN.md"]);

/**
 * Check if a .md file inside a plugin should be promoted to SKILL.md.
 * Returns true when the file is likely skill content (not documentation, not inside agents/).
 */
export function isSkillMdCandidate(entry: string, relPath: string): boolean {
  if (!entry.endsWith(".md")) return false;
  if (entry === "SKILL.md") return false;
  if (COPY_SKIP_MD.has(entry)) return false;
  const parts = relPath.split("/");
  // Don't promote files inside agents/ subdirectories — those are agent templates
  if (parts.some((p) => p === "agents")) return false;
  // Don't promote files from commands/ — those are slash commands, not skill content
  if (parts.some((p) => p === "commands")) return false;
  return true;
}

export function copyPluginFiltered(sourceDir: string, targetDir: string, relBase = ""): void {
  mkdirSync(targetDir, { recursive: true });
  const entries = readdirSync(sourceDir);
  for (const entry of entries) {
    // 0809: Drop vskill-internal sidecars at any directory level. Sidecar
    // provenance is re-derived by transfer() at copy time; never propagated
    // by file copy.
    if (entry === ".vskill-source.json" || entry === ".vskill-meta.json") continue;
    const relPath = relBase ? `${relBase}/${entry}` : entry;
    const sourcePath = join(sourceDir, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      // Flatten: root-level commands/ and skills/ merge into the parent target dir
      const isFlattened = !relBase && (entry === "commands" || entry === "skills");
      let nextTargetDir = isFlattened ? targetDir : join(targetDir, entry);
      // Prevent double-nesting: when inside a flattened skills/ directory and
      // a skill subdirectory has the same name as the target directory
      // (e.g., single-skill plugin where pluginName == skillName),
      // merge into the target instead of creating a redundant nested directory.
      const inFlattenedSkills = relBase === "skills";
      if (inFlattenedSkills && entry === basename(targetDir)) {
        nextTargetDir = targetDir;
      }
      copyPluginFiltered(sourcePath, nextTargetDir, relPath);
    } else if (stat.isFile() && !shouldSkipFromCommands(relPath)) {
      if (entry === "SKILL.md" || isSkillMdCandidate(entry, relPath)) {
        const raw = readFileSync(sourcePath, "utf-8");
        const skillName = basename(relBase || sourceDir);
        writeFileSync(join(targetDir, "SKILL.md"), ensureFrontmatter(raw, skillName), "utf-8");
      } else {
        copyFileSync(sourcePath, join(targetDir, entry));
      }
    }
  }
}
