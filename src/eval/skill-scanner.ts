// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
//
// Supports five layouts (all scanned from root=cwd):
//   1. Direct:   {root}/{plugin}/skills/{skill}/SKILL.md
//   2. Nested:   {root}/plugins/{plugin}/skills/{skill}/SKILL.md
//   3. Root:     {root}/skills/{skill}/SKILL.md  (plugin = repo basename)
//   4. Self:     {root}/SKILL.md  (root IS the skill directory itself)
//   5. Flat:     {root}/{skill}/SKILL.md  (skills as direct children of root)
//
// 0686 adds tri-scope scanning (own | installed | global) via
// scanSkillsTriScope(), plus symlink + installMethod classification.
// ---------------------------------------------------------------------------

import type { Dirent } from "node:fs";
import { readdirSync, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { join, basename, dirname, relative, sep } from "node:path";
import {
  AGENTS_REGISTRY,
  NON_AGENT_CONFIG_DIRS,
  type AgentDefinition,
} from "../agents/agents-registry.js";
import { resolveGlobalSkillsDir } from "./path-utils.js";

/** Scope classification — where a skill lives in the three-part world. */
export type SkillScope = "own" | "installed" | "global";

/**
 * 0698 T-001: new scope vocabulary aligned with Anthropic docs.
 * Coexists with legacy `SkillScope`; api.ts boundary normalizer translates.
 */
export type SkillScopeV2 =
  | "available-project"
  | "available-personal"
  | "available-plugin"
  | "authoring-project"
  | "authoring-plugin";

export type SkillGroup = "available" | "authoring";
export type SkillSource = "project" | "personal" | "plugin";

/** How the skill ended up on disk: authored in-project, copied from a cache,
 *  or symlinked to a canonical source (typically a plugin cache). */
export type SkillInstallMethod = "authored" | "copied" | "symlinked";

export interface SkillInfo {
  plugin: string;
  skill: string;
  dir: string;
  hasEvals: boolean;
  hasBenchmark: boolean;
  /** 0682 origin split — still populated for back-compat (SSoT for 0683). */
  origin: "source" | "installed";
  /** 0686 tri-scope classification. Defaults to "own" for the two-scope
   *  `scanSkills()` path to stay backward-compatible. */
  scope?: SkillScope;
  /** 0686 symlink metadata — always set by scanSkillsTriScope(). */
  isSymlink?: boolean;
  symlinkTarget?: string | null;
  installMethod?: SkillInstallMethod;
  /** 0686 sourceAgent — the registry agent id whose scope owns this skill.
   *  null for own-scope skills. */
  sourceAgent?: string | null;
  // -------------------------------------------------------------------------
  // 0698 T-001/T-002: new scope vocabulary + derivations + precedence.
  // scopeV2 is the Anthropic-aligned 5-value union. group/source are derived.
  // precedenceRank orders within AVAILABLE (personal=1, project=2, plugin=-1).
  // shadowedBy is set on the loser when same skill name appears in multiple
  // AVAILABLE scopes; null on the winner; undefined for AUTHORING/plugin rows.
  // -------------------------------------------------------------------------
  scopeV2?: SkillScopeV2;
  group?: SkillGroup;
  source?: SkillSource;
  precedenceRank?: number;
  shadowedBy?: SkillScopeV2 | null;
  /** 0698 T-004/T-005 plugin metadata — set when source === "plugin". */
  pluginName?: string | null;
  pluginNamespace?: string | null;
  pluginMarketplace?: string | null;
  pluginManifestPath?: string | null;
  pluginVersion?: string | null;
}

/** 0698 T-002: translate legacy scope → new 5-value vocabulary. */
function legacyToV2(legacy: SkillScope): SkillScopeV2 {
  if (legacy === "installed") return "available-project";
  if (legacy === "global") return "available-personal";
  return "authoring-project"; // "own"
}

function groupFor(v2: SkillScopeV2): SkillGroup {
  return v2.startsWith("available-") ? "available" : "authoring";
}

function sourceFor(v2: SkillScopeV2): SkillSource {
  return v2.slice(v2.indexOf("-") + 1) as SkillSource;
}

function precedenceRankFor(v2: SkillScopeV2): number {
  // Anthropic precedence: personal > project. Plugins orthogonal (-1).
  // Lower wins within AVAILABLE.
  if (v2 === "available-personal") return 1;
  if (v2 === "available-project") return 2;
  if (v2 === "available-plugin") return -1;
  if (v2 === "authoring-plugin") return -1;
  return 3; // authoring-project (no shadowing competition)
}

/** 0698 T-002: enrich a list of scanned skills with scopeV2/group/source/
 *  precedenceRank, then compute shadowing within AVAILABLE (same name collisions).
 *  Plugin-scope skills are orthogonal (never shadowed, never shadow).
 *  AUTHORING skills never get a shadowedBy.
 */
function enrichAndComputePrecedence(skills: SkillInfo[]): SkillInfo[] {
  // Phase 1: fill scopeV2, group, source, precedenceRank.
  const enriched = skills.map((s) => {
    const legacy: SkillScope = s.scope ?? "own";
    const scopeV2 = legacyToV2(legacy);
    return {
      ...s,
      scopeV2,
      group: groupFor(scopeV2),
      source: sourceFor(scopeV2),
      precedenceRank: precedenceRankFor(scopeV2),
    };
  });

  // Phase 2: group AVAILABLE non-plugin entries by skill name, pick a winner,
  // set shadowedBy on losers / null on winners.
  const availableByName = new Map<string, SkillInfo[]>();
  for (const s of enriched) {
    if (s.group !== "available") continue;
    if (s.source === "plugin") continue; // orthogonal
    const bucket = availableByName.get(s.skill) ?? [];
    bucket.push(s);
    availableByName.set(s.skill, bucket);
  }

  for (const group of availableByName.values()) {
    // Lowest precedenceRank wins.
    const sorted = [...group].sort((a, b) => (a.precedenceRank ?? 99) - (b.precedenceRank ?? 99));
    const winner = sorted[0];
    winner.shadowedBy = null;
    for (let i = 1; i < sorted.length; i++) {
      sorted[i].shadowedBy = winner.scopeV2 ?? null;
    }
  }

  // Phase 3: winners in AVAILABLE that weren't in any collision still need
  // shadowedBy=null explicitly. Plugin and AUTHORING entries leave it undefined.
  for (const s of enriched) {
    if (s.group === "available" && s.source !== "plugin" && s.shadowedBy === undefined) {
      s.shadowedBy = null;
    }
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Origin classification — detect if a skill lives inside an agent config
// directory (installed/consumed) vs. a user's own project (source/editable).
// ---------------------------------------------------------------------------

/** Lazily built set of all known agent config directory prefixes.
 *  Union of agent localSkillsDir first-segments + NON_AGENT_CONFIG_DIRS
 *  (the canonical non-agent config dirs co-located in agents-registry). */
let _installedPrefixes: Set<string> | null = null;

function getInstalledPrefixes(): Set<string> {
  if (_installedPrefixes) return _installedPrefixes;
  const prefixes = new Set<string>();
  for (const agent of AGENTS_REGISTRY) {
    // Extract first path segment: ".claude/skills" → ".claude"
    const first = agent.localSkillsDir.split("/")[0];
    if (first) prefixes.add(first);
  }
  for (const dir of NON_AGENT_CONFIG_DIRS) {
    prefixes.add(dir);
  }
  _installedPrefixes = prefixes;
  return prefixes;
}

/**
 * 0740: Defensive dedupe by canonical `dir`. The Layout 2 walker in this file
 * already skips manifest-bearing plugin dirs to prevent overlap with
 * `scanAuthoredPluginSkills`, but if a future scanner pass introduces overlap
 * we collapse here. Precedence: `authoring-plugin` (manifest-backed) wins
 * over any other `scopeV2` since the plugin manifest is the source of truth
 * for that subtree.
 *
 * Returns a new array; does not mutate input. When duplicates are dropped
 * the dropped entries are reported via `console.warn` once per call so
 * regressions stay visible.
 */
export function dedupeByDir(skills: SkillInfo[]): SkillInfo[] {
  const byDir = new Map<string, SkillInfo>();
  const dropped: { dir: string; kept: string; dropped: string }[] = [];

  for (const s of skills) {
    const existing = byDir.get(s.dir);
    if (!existing) {
      byDir.set(s.dir, s);
      continue;
    }
    // Same dir collision — pick the manifest-backed entry.
    const sIsAuthoringPlugin = s.scopeV2 === "authoring-plugin";
    const existingIsAuthoringPlugin = existing.scopeV2 === "authoring-plugin";
    if (sIsAuthoringPlugin && !existingIsAuthoringPlugin) {
      byDir.set(s.dir, s);
      dropped.push({ dir: s.dir, kept: String(s.scopeV2), dropped: String(existing.scopeV2) });
    } else if (!sIsAuthoringPlugin && existingIsAuthoringPlugin) {
      dropped.push({ dir: s.dir, kept: String(existing.scopeV2), dropped: String(s.scopeV2) });
    } else {
      // Neither (or both) authoring-plugin — keep first-seen, log the drop.
      dropped.push({ dir: s.dir, kept: String(existing.scopeV2), dropped: String(s.scopeV2) });
    }
  }

  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[0740] dedupeByDir collapsed ${dropped.length} duplicate skill ${dropped.length === 1 ? "row" : "rows"}: ${
        dropped.map((d) => `${d.dir} (kept ${d.kept}, dropped ${d.dropped})`).join("; ")
      }`,
    );
  }

  return Array.from(byDir.values());
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

/** Map a first-segment directory name back to the owning registry agent, if any.
 *  Accepts inputs like ".claude" and ".cursor". Returns null for unknown. */
function agentIdForLocalPrefix(firstSegment: string): string | null {
  for (const agent of AGENTS_REGISTRY) {
    const agentFirst = agent.localSkillsDir.split("/")[0];
    if (agentFirst === firstSegment) return agent.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Two-scope scanner (pre-0686 surface kept stable for /api/skills callers)
// ---------------------------------------------------------------------------

export async function scanSkills(root: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  if (!existsSync(root)) return skills;

  // Layout 4: root IS the skill directory itself → {root}/SKILL.md.
  // Authoring projects (e.g. `vskill new`) put a SKILL.md at the project root
  // AND may also have skills installed under `.claude/skills/...` from
  // `vskill install`. We must NOT early-return after the self-skill — the
  // remaining layouts below pick up the installed copies (Layout 1 walks
  // `.claude` as a "plugin" subdir and finds its `skills/` children).
  if (existsSync(join(root, "SKILL.md"))) {
    const skillName = basename(root);
    const parent = basename(dirname(root));
    let pluginName: string;
    if (parent === "skills") {
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
  }

  // Layout 3: root-level skills/ directory → {root}/skills/{skill}/SKILL.md
  scanSkillsDir(basename(root) || "default", join(root, "skills"), skills, root);

  // Layout 1: direct plugin subdirs → {root}/{plugin}/skills/{skill}/SKILL.md
  scanPluginDirs(root, skills, ["skills", "plugins"], root);

  // Layout 2: nested plugins/ dir → {root}/plugins/{plugin}/skills/{skill}/SKILL.md
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    scanPluginDirs(pluginsDir, skills, ["plugins"], root);
  }

  // Layout 5: flat → {root}/{skill}/SKILL.md (skills as direct children of root)
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
      .filter((d) => isDirOrDirSymlink(d, join(dir, d.name)) && !exclude.includes(d.name))
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const plugin of entries) {
    // 0740: skip plugin directories that have a `.claude-plugin/plugin.json`
    // manifest. Those subtrees are owned by `scanAuthoredPluginSkills()` (see
    // plugin-scanner.ts), which emits them with `scopeV2: "authoring-plugin"`.
    // Without this skip, the same physical `dir` would be emitted twice in
    // `/api/skills` (once here as `authoring-project`, once again as
    // `authoring-plugin`), producing duplicate sidebar rows. Bug surfaced in
    // 0740 after vskill@0.5.116; see spec for the obsidian-brain repro.
    if (existsSync(join(dir, plugin, ".claude-plugin", "plugin.json"))) {
      continue;
    }
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
      .filter((d) => isDirOrDirSymlink(d, join(skillsDir, d.name)))
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

// ---------------------------------------------------------------------------
// 0686: tri-scope scanner
//
// Returns SkillInfo[] partitioned into own | installed | global. Each entry
// carries symlink metadata so the UI can render a chain-link glyph + install
// method row without re-walking the filesystem.
// ---------------------------------------------------------------------------

export interface TriScopeOptions {
  /** Registry id of the active agent whose installed + global scopes we surface. */
  agentId: string;
  /** Override the home dir used for the global scope. Primarily for tests and
   *  for contexts that want to point at a fixture home. When unset, the global
   *  dir is resolved via `resolveGlobalSkillsDir(agent)` (which reads
   *  `os.homedir()` + platform fallback rules). */
  home?: string;
}

/**
 * Scan a project root and an agent's global skills dir, returning all three
 * scopes tagged with scope/installMethod/symlink metadata.
 */
export async function scanSkillsTriScope(
  root: string,
  opts: TriScopeOptions,
): Promise<SkillInfo[]> {
  const results: SkillInfo[] = [];

  // --- OWN + INSTALLED (local project scan) ---
  const localSkills = await scanSkills(root);
  for (const s of localSkills) {
    results.push(enrichWithScopeAndSymlink(s, root));
  }

  // --- GLOBAL (agent's home skills dir) ---
  const agent = AGENTS_REGISTRY.find((a) => a.id === opts.agentId);
  if (agent) {
    const globalDir = opts.home
      ? join(opts.home, firstNonTildeSegment(agent.globalSkillsDir))
      : resolveGlobalSkillsDir(agent);

    if (existsSync(globalDir)) {
      // Agent's global dir points at `.../skills/` — iterate children as skills.
      const globals: SkillInfo[] = [];
      scanSkillsDir(agent.id, globalDir, globals, globalDir);
      for (const g of globals) {
        results.push({
          ...g,
          origin: "installed",
          scope: "global",
          sourceAgent: agent.id,
          ...symlinkFieldsFor(g.dir),
          installMethod: installMethodFor(g.dir, "global"),
        });
      }
    }
  }

  // 0698 T-002: enrich with new scope vocabulary + compute precedence/shadowing
  return enrichAndComputePrecedence(results);
}

/** Convert a globalSkillsDir pattern like `~/.claude/skills` to just the
 *  after-the-tilde portion (`.claude/skills`) for joining onto an injected
 *  fixture home. */
function firstNonTildeSegment(p: string): string {
  if (p.startsWith("~/") || p.startsWith("~\\")) return p.slice(2);
  if (p.startsWith("~")) return p.slice(1);
  return p;
}

/** Fold 0686 scope/symlink/installMethod/sourceAgent fields onto a SkillInfo
 *  returned by the two-scope scanner. */
function enrichWithScopeAndSymlink(s: SkillInfo, root: string): SkillInfo {
  const scope: SkillScope = s.origin === "installed" ? "installed" : "own";
  const symlink = symlinkFieldsFor(s.dir);
  const installMethod = installMethodFor(s.dir, scope, symlink.isSymlink);
  const sourceAgent = scope === "own" ? null : deriveSourceAgentFromDir(s.dir, root);
  return { ...s, scope, sourceAgent, ...symlink, installMethod };
}

/** Walk one level up through the relative path to identify the owning agent
 *  (e.g. `.claude/skills/foo` → `claude-code`). */
function deriveSourceAgentFromDir(skillDir: string, root: string): string | null {
  const rel = relative(root, skillDir).split(sep).join("/");
  const first = rel.split("/")[0];
  if (!first) return null;
  return agentIdForLocalPrefix(first);
}

/** Compute `{ isSymlink, symlinkTarget }` for a skill dir, with cycle safety.
 *  Uses lstatSync to detect the link, then realpathSync to resolve it. If the
 *  realpath walks through the same inode twice we treat it as a cycle and set
 *  the target to null (AC-US8-04). */
function symlinkFieldsFor(skillDir: string): {
  isSymlink: boolean;
  symlinkTarget: string | null;
} {
  let isSymlink = false;
  try {
    isSymlink = lstatSync(skillDir).isSymbolicLink();
  } catch {
    return { isSymlink: false, symlinkTarget: null };
  }
  if (!isSymlink) return { isSymlink: false, symlinkTarget: null };

  // Manual walk so we can detect cycles deterministically rather than relying
  // on realpathSync's exception on ELOOP (behavior varies by platform).
  const seen = new Set<string>();
  let current = skillDir;
  try {
    const firstKey = inodeKey(current);
    if (firstKey) seen.add(firstKey);
    // Bounded hop count in case the platform doesn't error on a cycle.
    for (let hops = 0; hops < 40; hops++) {
      let st;
      try {
        st = lstatSync(current);
      } catch {
        return { isSymlink: true, symlinkTarget: null };
      }
      if (!st.isSymbolicLink()) {
        // We reached the real target — validate it's still there.
        try {
          statSync(current);
        } catch {
          return { isSymlink: true, symlinkTarget: null };
        }
        return { isSymlink: true, symlinkTarget: current };
      }
      let next: string;
      try {
        next = realpathSync.native?.(current) ?? realpathSync(current);
      } catch {
        // realpath may ELOOP on a cycle — that's exactly the scenario we warn about.
        console.warn(`[skill-scanner] cycle detected while resolving ${skillDir}`);
        return { isSymlink: true, symlinkTarget: null };
      }
      const key = inodeKey(next);
      if (!key) {
        return { isSymlink: true, symlinkTarget: null };
      }
      if (seen.has(key)) {
        console.warn(`[skill-scanner] cycle detected while resolving ${skillDir}`);
        return { isSymlink: true, symlinkTarget: null };
      }
      seen.add(key);
      if (next === current) {
        return { isSymlink: true, symlinkTarget: current };
      }
      current = next;
    }
    console.warn(`[skill-scanner] symlink depth exceeded while resolving ${skillDir}`);
    return { isSymlink: true, symlinkTarget: null };
  } catch {
    return { isSymlink: true, symlinkTarget: null };
  }
}

function inodeKey(p: string): string | null {
  try {
    const st = lstatSync(p);
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
}

function installMethodFor(
  skillDir: string,
  scope: SkillScope,
  isSymlink?: boolean,
): SkillInstallMethod {
  if (scope === "own") return "authored";
  const symlink = isSymlink ?? lstatSafeIsSymlink(skillDir);
  return symlink ? "symlinked" : "copied";
}

function lstatSafeIsSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Accept plain directories AND symlinks whose target is a directory. */
function isDirOrDirSymlink(d: Dirent, fullPath: string): boolean {
  if (d.isDirectory()) return true;
  if (!d.isSymbolicLink()) return false;
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    // Broken symlink, or a cycle that ELOOPs on stat — either way, skip it.
    return false;
  }
}
