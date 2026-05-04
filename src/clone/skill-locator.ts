// ---------------------------------------------------------------------------
// vskill clone — skill-locator
// ---------------------------------------------------------------------------
// Discover a source skill across the three supported locations, in deterministic
// order. The caller (orchestrator in src/commands/clone.ts) decides what to do
// with multiple matches (interactive disambiguation or honor --source override).
//
// Search order:
//   1. project   → <cwd>/.claude/skills/<skill>/SKILL.md
//   2. personal  → <home>/.claude/skills/<skill>/SKILL.md
//   3. cache     → <home>/.claude/plugins/cache/<org>/<plugin>/<version>/skills/<skill>/SKILL.md
//
// Source identifiers may be passed as:
//   - "ado-mapper"     (bare skill name)
//   - "sw/ado-mapper"  (namespace/skill — namespace is treated informationally)
//
// See spec.md AC-US1-01 and plan.md §4.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { join, basename } from "node:path";

import type { SkillSource, SkillSourceLocation } from "./types.js";
import type { Provenance } from "../studio/types.js";
import { readProvenance } from "../studio/lib/provenance.js";

export interface LocateOptions {
  /** Working directory to use as the project root (defaults to process.cwd()). */
  cwd?: string;
  /** Home directory (defaults to os.homedir() — explicit for testability). */
  home: string;
}

/** Captured `name:` and `version:` from a SKILL.md frontmatter block. */
interface ParsedFrontmatter {
  name?: string;
  version?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const NAME_LINE_RE = /^name:\s*(.+?)\s*$/m;
const VERSION_LINE_RE = /^version:\s*(.+?)\s*$/m;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function parseSkillMd(skillMdPath: string): Promise<ParsedFrontmatter> {
  try {
    const raw = await fs.readFile(skillMdPath, "utf-8");
    const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const fmMatch = normalized.match(FRONTMATTER_RE);
    if (!fmMatch) return {};
    const block = fmMatch[1];
    const nameMatch = block.match(NAME_LINE_RE);
    const versionMatch = block.match(VERSION_LINE_RE);
    return {
      name: nameMatch ? unquote(nameMatch[1]) : undefined,
      version: versionMatch ? unquote(versionMatch[1]) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Split a source identifier like "sw/ado-mapper" into namespace + skill, or
 * return only the skill when no namespace is present.
 */
export function parseSourceIdent(source: string): { namespace?: string; skill: string } {
  const idx = source.indexOf("/");
  if (idx === -1) return { skill: source };
  return { namespace: source.slice(0, idx), skill: source.slice(idx + 1) };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function buildSource(
  location: SkillSourceLocation,
  skillDir: string,
  fallbackSkillName: string,
  pluginCtx?: SkillSource["plugin"],
): Promise<SkillSource | null> {
  const skillMd = join(skillDir, "SKILL.md");
  if (!(await exists(skillMd))) return null;

  const fm = await parseSkillMd(skillMd);
  const fullName = fm.name ?? fallbackSkillName;
  const slashIdx = fullName.indexOf("/");
  const namespace = slashIdx >= 0 ? fullName.slice(0, slashIdx) : undefined;

  let existingProvenance: Provenance | null = null;
  try {
    existingProvenance = await readProvenance(skillDir);
  } catch {
    existingProvenance = null;
  }

  return {
    location,
    skillDir,
    skillName: fullName,
    namespace,
    version: fm.version ?? "0.0.0",
    plugin: pluginCtx,
    existingProvenance,
  };
}

async function locateInProject(
  cwd: string,
  skill: string,
): Promise<SkillSource | null> {
  const dir = join(cwd, ".claude", "skills", skill);
  if (!(await dirExists(dir))) return null;
  return buildSource("project", dir, skill);
}

async function locateInPersonal(
  home: string,
  skill: string,
): Promise<SkillSource | null> {
  const dir = join(home, ".claude", "skills", skill);
  if (!(await dirExists(dir))) return null;
  return buildSource("personal", dir, skill);
}

async function locateInCache(
  home: string,
  skill: string,
  preferredNamespace?: string,
): Promise<SkillSource[]> {
  const cacheRoot = join(home, ".claude", "plugins", "cache");
  if (!(await dirExists(cacheRoot))) return [];

  const matches: SkillSource[] = [];
  let orgs: string[];
  try {
    orgs = await fs.readdir(cacheRoot);
  } catch {
    return [];
  }

  for (const org of orgs) {
    const orgDir = join(cacheRoot, org);
    if (!(await dirExists(orgDir))) continue;

    let plugins: string[];
    try {
      plugins = await fs.readdir(orgDir);
    } catch {
      continue;
    }

    for (const pluginName of plugins) {
      const pluginRoot = join(orgDir, pluginName);
      if (!(await dirExists(pluginRoot))) continue;

      let versions: string[];
      try {
        versions = await fs.readdir(pluginRoot);
      } catch {
        continue;
      }

      for (const version of versions) {
        const skillDir = join(pluginRoot, version, "skills", skill);
        if (!(await dirExists(skillDir))) continue;

        const built = await buildSource("cache", skillDir, skill, {
          pluginNamespace: org,
          pluginName,
          pluginVersion: version,
          pluginRoot: join(pluginRoot, version),
        });
        if (!built) continue;

        if (preferredNamespace && built.namespace && built.namespace !== preferredNamespace) {
          continue;
        }

        matches.push(built);
      }
    }
  }

  return matches;
}

/**
 * Discover a skill across project / personal / cache. Returns every match in
 * search order — the orchestrator handles disambiguation when there is more
 * than one and `--source` was not explicitly provided.
 */
export async function locateSkill(
  source: string,
  opts: LocateOptions,
): Promise<SkillSource[]> {
  const { skill, namespace } = parseSourceIdent(source);
  const cwd = opts.cwd ?? process.cwd();

  const matches: SkillSource[] = [];

  const project = await locateInProject(cwd, skill);
  if (project && (!namespace || project.namespace === namespace || !project.namespace)) {
    matches.push(project);
  }

  const personal = await locateInPersonal(opts.home, skill);
  if (personal && (!namespace || personal.namespace === namespace || !personal.namespace)) {
    matches.push(personal);
  }

  const cache = await locateInCache(opts.home, skill, namespace);
  matches.push(...cache);

  return matches;
}

/**
 * Enumerate every skill inside a cached plugin. Used by the whole-plugin
 * clone path (T-010). Returns a list of SkillSource entries (one per skill).
 */
export async function enumeratePluginSkills(
  pluginName: string,
  opts: LocateOptions,
): Promise<SkillSource[]> {
  const cacheRoot = join(opts.home, ".claude", "plugins", "cache");
  if (!(await dirExists(cacheRoot))) return [];

  const results: SkillSource[] = [];
  let orgs: string[];
  try {
    orgs = await fs.readdir(cacheRoot);
  } catch {
    return [];
  }

  for (const org of orgs) {
    const pluginRoot = join(cacheRoot, org, pluginName);
    if (!(await dirExists(pluginRoot))) continue;

    let versions: string[];
    try {
      versions = await fs.readdir(pluginRoot);
    } catch {
      continue;
    }

    for (const version of versions) {
      const skillsDir = join(pluginRoot, version, "skills");
      if (!(await dirExists(skillsDir))) continue;

      let skillEntries: string[];
      try {
        skillEntries = await fs.readdir(skillsDir);
      } catch {
        continue;
      }

      for (const skillEntry of skillEntries) {
        const skillDir = join(skillsDir, skillEntry);
        if (!(await dirExists(skillDir))) continue;

        const built = await buildSource("cache", skillDir, basename(skillDir), {
          pluginNamespace: org,
          pluginName,
          pluginVersion: version,
          pluginRoot: join(pluginRoot, version),
        });
        if (built) results.push(built);
      }
    }
  }

  return results;
}
