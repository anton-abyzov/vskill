// ---------------------------------------------------------------------------
// 0698 T-004/T-005: Claude Code plugin scanners.
//
// T-004 scanInstalledPluginSkills — walks
//   <home>/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md
// and emits SkillInfo with scope="installed" / scopeV2="available-plugin".
// When multiple versions of the same plugin coexist, the highest semver wins.
//
// T-005 scanAuthoredPluginSkills — walks a project root up to depth 4 for
//   **/.claude-plugin/plugin.json, then reads sibling skills/<skill>/SKILL.md,
// emitting scope="own" / scopeV2="authoring-plugin".
//
// Both are Claude Code ONLY — non-CC agents receive [].
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import type { SkillInfo } from "./skill-scanner.js";

const CLAUDE_CODE_AGENT_ID = "claude-code";

// Folders we never descend into when globbing for authored-plugin manifests.
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  ".specweave",
]);

// -----------------------------------------------------------------------------
// T-004: scanInstalledPluginSkills
// -----------------------------------------------------------------------------

export interface InstalledPluginScanOptions {
  agentId: string;
  /** Override home dir (tests). */
  home?: string;
}

export function scanInstalledPluginSkills(
  opts: InstalledPluginScanOptions,
): SkillInfo[] {
  if (opts.agentId !== CLAUDE_CODE_AGENT_ID) return [];
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) return [];

  const cacheDir = join(home, ".claude", "plugins", "cache");
  if (!existsSync(cacheDir)) return [];

  const results: SkillInfo[] = [];
  const marketplaces = safeReaddir(cacheDir);
  for (const marketplace of marketplaces) {
    const marketplaceDir = join(cacheDir, marketplace);
    if (!isDir(marketplaceDir)) continue;

    const plugins = safeReaddir(marketplaceDir);
    for (const pluginName of plugins) {
      const pluginDir = join(marketplaceDir, pluginName);
      if (!isDir(pluginDir)) continue;

      // Find version dirs — pick highest semver.
      const versions = safeReaddir(pluginDir).filter((v) =>
        isDir(join(pluginDir, v)),
      );
      if (versions.length === 0) continue;
      const winner = pickHighestSemver(versions);
      const versionDir = join(pluginDir, winner);

      const skillsDir = join(versionDir, "skills");
      if (!existsSync(skillsDir) || !isDir(skillsDir)) continue;

      for (const skillName of safeReaddir(skillsDir)) {
        const skillDir = join(skillsDir, skillName);
        const skillMd = join(skillDir, "SKILL.md");
        if (!existsSync(skillMd)) continue;

        results.push({
          plugin: pluginName,
          skill: skillName,
          dir: skillDir,
          hasEvals: false,
          hasBenchmark: false,
          origin: "installed",
          scope: "installed",
          scopeV2: "available-plugin",
          group: "available",
          source: "plugin",
          precedenceRank: -1,
          installMethod: "symlinked",
          sourceAgent: CLAUDE_CODE_AGENT_ID,
          pluginName,
          pluginNamespace: `${pluginName}:${skillName}`,
          pluginMarketplace: marketplace,
          pluginVersion: winner,
          pluginManifestPath: maybePluginManifestPath(versionDir),
        });
      }
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// T-005: scanAuthoredPluginSkills
// -----------------------------------------------------------------------------

export interface AuthoredPluginScanOptions {
  agentId: string;
  projectRoot: string;
  /** Max directory depth (from projectRoot) at which to discover plugin manifests. */
  maxDepth?: number;
}

export function scanAuthoredPluginSkills(
  opts: AuthoredPluginScanOptions,
): SkillInfo[] {
  if (opts.agentId !== CLAUDE_CODE_AGENT_ID) return [];
  const root = opts.projectRoot;
  if (!existsSync(root)) return [];

  // Default depth 4: <root>/a/b/c/<plugin-name>/.claude-plugin/plugin.json
  // where depth counts segments between root and the plugin-name folder.
  const maxDepth = opts.maxDepth ?? 4;

  const results: SkillInfo[] = [];
  const manifests = findPluginManifests(root, maxDepth);
  for (const manifestPath of manifests) {
    // manifestPath = <...>/<plugin-name>/.claude-plugin/plugin.json
    const pluginSourceDir = dirname(dirname(manifestPath));
    const pluginName = basename(pluginSourceDir);
    const skillsDir = join(pluginSourceDir, "skills");
    if (!existsSync(skillsDir) || !isDir(skillsDir)) continue;

    for (const skillName of safeReaddir(skillsDir)) {
      const skillDir = join(skillsDir, skillName);
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      results.push({
        plugin: pluginName,
        skill: skillName,
        dir: skillDir,
        hasEvals: false,
        hasBenchmark: false,
        origin: "source",
        scope: "own",
        scopeV2: "authoring-plugin",
        group: "authoring",
        source: "plugin",
        precedenceRank: -1,
        installMethod: "authored",
        sourceAgent: null,
        pluginName,
        pluginNamespace: `${pluginName}:${skillName}`,
        pluginMarketplace: null,
        pluginVersion: extractVersionFromManifest(manifestPath),
        pluginManifestPath: manifestPath,
      });
    }
  }

  return results;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

/**
 * Walk `root` up to `maxDepth` levels looking for `.claude-plugin/plugin.json`.
 * `maxDepth` counts segments between root and the PLUGIN folder (the one that
 * contains `.claude-plugin/`). Folders in `EXCLUDE_DIRS` are skipped.
 * Returns absolute paths to each found `plugin.json`.
 */
function findPluginManifests(root: string, maxDepth: number): string[] {
  const out: string[] = [];

  function walk(dir: string, depth: number): void {
    // First, if this directory IS a plugin source, record it.
    const manifestPath = join(dir, ".claude-plugin", "plugin.json");
    if (existsSync(manifestPath)) {
      out.push(manifestPath);
      // Don't descend further inside a plugin source — its skills belong to it.
      return;
    }

    if (depth >= maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (EXCLUDE_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".claude-plugin") {
        // skip hidden dirs except the one we explicitly care about at this level
        continue;
      }
      const childPath = join(dir, name);
      if (!isDir(childPath)) continue;
      walk(childPath, depth + 1);
    }
  }

  walk(root, 0);
  return out;
}

function maybePluginManifestPath(versionDir: string): string | null {
  const manifest = join(versionDir, ".claude-plugin", "plugin.json");
  return existsSync(manifest) ? manifest : null;
}

function extractVersionFromManifest(manifestPath: string): string | null {
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const data = JSON.parse(raw) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Pick the highest semver-like version from a list of directory names.
 * Falls back to string-sort descending if parsing fails on any entry.
 */
function pickHighestSemver(versions: string[]): string {
  const parsed = versions
    .map((v) => ({ v, parts: parseSemverTuple(v) }))
    .filter((x) => x.parts !== null) as Array<{
    v: string;
    parts: [number, number, number];
  }>;

  if (parsed.length === 0) {
    // Fallback: lexicographic descending
    return [...versions].sort().reverse()[0];
  }

  parsed.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.parts[i] !== b.parts[i]) return b.parts[i] - a.parts[i];
    }
    return 0;
  });
  return parsed[0].v;
}

function parseSemverTuple(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
