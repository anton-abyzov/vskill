// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
//
// Supports five layouts (all scanned from root=cwd):
//   1. Direct:   {root}/{plugin}/skills/{skill}/SKILL.md
//   2. Nested:   {root}/plugins/{plugin}/skills/{skill}/SKILL.md
//   3. Root:     {root}/skills/{skill}/SKILL.md  (plugin = repo basename)
//   4. Self:     {root}/SKILL.md  (root IS the skill directory itself)
//   5. Flat:     {root}/{skill}/SKILL.md  (skills as direct children of root)
// ---------------------------------------------------------------------------

import { readdirSync, existsSync } from "node:fs";
import { join, basename, dirname, relative, sep } from "node:path";
import { AGENTS_REGISTRY } from "../agents/agents-registry.js";

export interface SkillInfo {
  plugin: string;
  skill: string;
  dir: string;
  hasEvals: boolean;
  hasBenchmark: boolean;
  origin: "source" | "installed";
}

// ---------------------------------------------------------------------------
// Origin classification — detect if a skill lives inside an agent config
// directory (installed/consumed) vs. a user's own project (source/editable).
// ---------------------------------------------------------------------------

/** Extra known config dirs not covered by agents-registry localSkillsDir. */
const EXTRA_CONFIG_DIRS = [
  ".specweave", ".vscode", ".idea", ".zed", ".devcontainer",
  ".github", ".agents", ".agent",
];

/** Lazily built set of all known agent config directory prefixes. */
let _installedPrefixes: Set<string> | null = null;

function getInstalledPrefixes(): Set<string> {
  if (_installedPrefixes) return _installedPrefixes;
  const prefixes = new Set<string>();
  for (const agent of AGENTS_REGISTRY) {
    // Extract first path segment: ".claude/skills" → ".claude"
    const first = agent.localSkillsDir.split("/")[0];
    if (first) prefixes.add(first);
  }
  for (const dir of EXTRA_CONFIG_DIRS) {
    prefixes.add(dir);
  }
  _installedPrefixes = prefixes;
  return prefixes;
}

/**
 * Classify a skill's origin based on its filesystem path relative to root.
 * Skills inside agent config directories or plugin caches are "installed".
 */
export function classifyOrigin(skillDir: string, root: string): "source" | "installed" {
  const rel = relative(root, skillDir).split(sep).join("/");
  // Check if the relative path starts with a known agent config prefix
  const firstSegment = rel.split("/")[0];
  if (firstSegment && getInstalledPrefixes().has(firstSegment)) {
    return "installed";
  }
  // Check for plugin cache directories (e.g. plugins/cache/...)
  if (rel.includes("plugins/cache/")) {
    return "installed";
  }
  return "source";
}

export async function scanSkills(root: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  if (!existsSync(root)) return skills;

  // Layout 4: root IS the skill directory itself → {root}/SKILL.md
  // Walk up from the skill dir to find the plugin name:
  //   .../plugins/{plugin}/skills/{skill}/  →  plugin = grandparent of skill
  //   .../skills/{skill}/                   →  plugin = parent above "skills"
  // Fallback to immediate parent if structure is unknown.
  if (existsSync(join(root, "SKILL.md"))) {
    const skillName = basename(root);
    const parent = basename(dirname(root)); // e.g. "skills"
    let pluginName: string;
    if (parent === "skills") {
      // Standard layout: .../plugins/{plugin}/skills/{skill}/ or .../{plugin}/skills/{skill}/
      pluginName = basename(dirname(dirname(root))) || "default";
    } else {
      pluginName = parent || "default";
    }
    const hasEvals = existsSync(join(root, "evals", "evals.json"));
    const hasBenchmark = existsSync(join(root, "evals", "benchmark.json"));
    skills.push({
      plugin: pluginName,
      skill: skillName,
      dir: root,
      hasEvals,
      hasBenchmark,
      origin: classifyOrigin(root, root),
    });
    return skills;
  }

  // Layout 3: root-level skills/ directory → {root}/skills/{skill}/SKILL.md
  scanSkillsDir(basename(root) || "default", join(root, "skills"), skills, root);

  // Layout 1: direct plugin subdirs → {root}/{plugin}/skills/{skill}/SKILL.md
  // Exclude "skills" (Layout 3) and "plugins" (Layout 2) from being treated as plugins
  scanPluginDirs(root, skills, ["skills", "plugins"], root);

  // Layout 2: nested plugins/ dir → {root}/plugins/{plugin}/skills/{skill}/SKILL.md
  // Only exclude "plugins" to prevent recursion; "skills" is a valid plugin name here
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    scanPluginDirs(pluginsDir, skills, ["plugins"], root);
  }

  // Layout 5: flat → {root}/{skill}/SKILL.md (skills as direct children of root)
  // Only pick up directories not already matched by layouts 1-3.
  if (skills.length === 0) {
    const defaultPlugin = basename(root) || "default";
    scanSkillsDir(defaultPlugin, root, skills, root);
  }

  return skills;
}

function scanPluginDirs(dir: string, skills: SkillInfo[], exclude: string[], root: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !exclude.includes(d.name))
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const plugin of entries) {
    scanSkillsDir(plugin, join(dir, plugin, "skills"), skills, root);
  }
}

function scanSkillsDir(
  plugin: string,
  skillsDir: string,
  skills: SkillInfo[],
  root: string,
): void {
  if (!existsSync(skillsDir)) return;

  let skillDirs: string[];
  try {
    skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const skill of skillDirs) {
    const skillDir = join(skillsDir, skill);
    const skillMd = join(skillDir, "SKILL.md");

    if (!existsSync(skillMd)) continue;

    const hasEvals = existsSync(join(skillDir, "evals", "evals.json"));
    const hasBenchmark = existsSync(
      join(skillDir, "evals", "benchmark.json"),
    );

    skills.push({ plugin, skill, dir: skillDir, hasEvals, hasBenchmark, origin: classifyOrigin(skillDir, root) });
  }
}
