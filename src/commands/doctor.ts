// ---------------------------------------------------------------------------
// vskill doctor -- check (and optionally fix) skill folders across agents
//
// 0894 T-04 (AC-05). Scans every skills folder an agent reads, per the agent
// registry (own dir, extra dirs, and the shared `.agents/skills`), in the
// global and/or project scope, and reports:
//
//   divergent        same folder name, 2+ real folders, different content
//   identical-copy   same folder name, 2+ real folders, byte-identical   (fix)
//   broken-link      symlink whose target does not exist                 (fix)
//   redundant-link   link in a dir whose every reader already sees the
//                    same skill through another dir it scans             (fix)
//   migration-damage SKILL.md carries migrate-to-codex residue
//   name-mismatch    frontmatter name != folder name
//   duplicate-name   two different folders visible to one agent declare
//                    the same frontmatter name
//   bad-name / bad-description  agentskills.io frontmatter limits
//   lock-missing     vskill.lock entry with nothing on disk (no skill
//                    folder, no plugin cache); report only
//
// `--fix` moves broken links into `<dir>/_archive/<date>/`, removes
// redundant links (the skill stays visible through another folder) and
// replaces byte-identical copies with a relative link to the copy in the
// shared folder. It never deletes or rewrites a real folder whose content is
// unique, and never edits a lockfile.
// ---------------------------------------------------------------------------

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AGENTS_REGISTRY, type AgentDefinition } from "../agents/agents-registry.js";
import { stripClaudeFields } from "../installer/frontmatter.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";

export type DoctorScope = "global" | "project";
export type DoctorSeverity = "error" | "warning";
export type DoctorIssueKind =
  | "divergent"
  | "identical-copy"
  | "broken-link"
  | "redundant-link"
  | "migration-damage"
  | "name-mismatch"
  | "duplicate-name"
  | "bad-name"
  | "bad-description"
  | "lock-missing";

export const DOCTOR_ISSUE_KINDS: readonly DoctorIssueKind[] = [
  "divergent",
  "identical-copy",
  "broken-link",
  "redundant-link",
  "migration-damage",
  "name-mismatch",
  "duplicate-name",
  "bad-name",
  "bad-description",
  "lock-missing",
];

const SEVERITY: Record<DoctorIssueKind, DoctorSeverity> = {
  divergent: "error",
  "identical-copy": "warning",
  "broken-link": "warning",
  "redundant-link": "warning",
  "migration-damage": "error",
  "name-mismatch": "warning",
  "duplicate-name": "error",
  "bad-name": "warning",
  "bad-description": "warning",
  "lock-missing": "warning",
};

export interface DoctorIssue {
  kind: DoctorIssueKind;
  severity: DoctorSeverity;
  scope: DoctorScope;
  /** Skill folder name (or declared name for duplicate-name). */
  skill: string;
  /** Every path involved; for identical-copy the first is the kept copy. */
  paths: string[];
  message: string;
  fixable: boolean;
  /** Agents affected, where it matters (redundant-link, duplicate-name). */
  agents?: string[];
}

export interface DoctorFixAction {
  kind: DoctorIssueKind;
  action: "remove-link" | "archive-link" | "replace-with-link";
  path: string;
  target?: string;
  ok: boolean;
  error?: string;
}

export interface ScannedDir {
  scope: DoctorScope;
  dir: string;
  readers: string[];
}

export interface DoctorReport {
  scopes: DoctorScope[];
  scanned: ScannedDir[];
  issues: DoctorIssue[];
  fixes: DoctorFixAction[];
  summary: Record<DoctorIssueKind, number>;
  /** Problems left after any fixes (equals issues.length). */
  remaining: number;
}

export interface DoctorOptions {
  global?: boolean;
  project?: boolean;
  json?: boolean;
  fix?: boolean;
  /** Test seams — default to the real home dir, cwd and platform. */
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

// ---------------------------------------------------------------------------
// Dir discovery
// ---------------------------------------------------------------------------

/** Agents that keep skills on the local filesystem. */
function filesystemAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter(
    (a) => a.isRemoteOnly !== true && a.installMode !== "clipboard",
  );
}

function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

/** Every dir an agent reads in a scope (absolute paths). */
export function agentSkillDirs(
  agent: AgentDefinition,
  scope: DoctorScope,
  home: string,
  cwd: string,
): string[] {
  const dirs: string[] = [];
  if (scope === "global") {
    if (agent.id === "antigravity" && process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR?.trim()) {
      dirs.push(resolve(process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR.trim()));
    }
    dirs.push(expandHome(agent.globalSkillsDir, home));
    for (const d of agent.extraGlobalSkillsDirs ?? []) dirs.push(expandHome(d, home));
    if (agent.readsSharedSkills?.global) dirs.push(join(home, ".agents", "skills"));
  } else {
    dirs.push(join(cwd, agent.localSkillsDir));
    for (const d of agent.extraLocalSkillsDirs ?? []) dirs.push(join(cwd, d));
    if (agent.readsSharedSkills?.project) dirs.push(join(cwd, ".agents", "skills"));
  }
  return [...new Set(dirs)];
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Errors that mean a link target really is gone (vs. unreadable right now:
 *  EACCES, EIO, ETIMEDOUT, ... on a locked folder or an unreachable share). */
const GONE_CODES = new Set(["ENOENT", "ENOTDIR", "ELOOP"]);

/** Resolve a link: its real path, or null with the error code. */
function resolveLink(p: string): { real: string | null; code?: string } {
  try {
    return { real: realpathSync(p) };
  } catch (err) {
    return { real: null, code: (err as NodeJS.ErrnoException).code ?? "EUNKNOWN" };
  }
}

interface DirInfo {
  scope: DoctorScope;
  /** Path as configured (first one seen for this real dir). */
  dir: string;
  real: string;
  readers: Set<string>;
  /** The shared `.agents/skills` folder for this scope. */
  shared: boolean;
}

function collectDirs(scope: DoctorScope, home: string, cwd: string): DirInfo[] {
  const sharedDir = scope === "global" ? join(home, ".agents", "skills") : join(cwd, ".agents", "skills");
  const byReal = new Map<string, DirInfo>();
  const add = (dir: string, reader: string | null) => {
    const real = safeRealpath(dir);
    if (!real) return;
    try {
      if (!statSync(real).isDirectory()) return;
    } catch {
      return;
    }
    let info = byReal.get(real);
    if (!info) {
      info = { scope, dir, real, readers: new Set(), shared: false };
      byReal.set(real, info);
    }
    if (dir === sharedDir) {
      info.shared = true;
      info.dir = sharedDir;
    }
    if (reader) info.readers.add(reader);
  };
  add(sharedDir, null);
  for (const agent of filesystemAgents()) {
    for (const dir of agentSkillDirs(agent, scope, home, cwd)) add(dir, agent.id);
  }
  return [...byReal.values()];
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

interface Entry {
  scope: DoctorScope;
  name: string;
  /** Path inside the scanned dir. */
  path: string;
  dirInfo: DirInfo;
  isLink: boolean;
  /** Resolved real folder; null for a broken or unreadable link. */
  real: string | null;
  /** Set when the link target could not be read for a reason other than
   *  being gone (EACCES, EIO, ...): reported, never removed. */
  unreadable?: string;
}

function listEntries(info: DirInfo, home: string): Entry[] {
  let names: string[];
  try {
    names = readdirSync(info.dir);
  } catch {
    return [];
  }
  const claudeSynced = join(home, ".claude", "skills", "synced");
  const out: Entry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const path = join(info.dir, name);
    // Claude-managed folder of synced skills — not ours to judge.
    if (info.scope === "global" && (path === claudeSynced || join(info.real, name) === safeRealpath(claudeSynced))) {
      continue;
    }
    let st;
    try {
      st = lstatSync(path);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      const { real, code } = resolveLink(path);
      if (real) {
        try {
          if (!statSync(real).isDirectory()) continue;
        } catch {
          continue;
        }
      }
      const entry: Entry = { scope: info.scope, name, path, dirInfo: info, isLink: true, real };
      if (!real && code && !GONE_CODES.has(code)) entry.unreadable = code;
      out.push(entry);
    } else if (st.isDirectory()) {
      if (!existsSync(join(path, "SKILL.md"))) continue;
      out.push({ scope: info.scope, name, path, dirInfo: info, isLink: false, real: safeRealpath(path) ?? path });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content hashing + frontmatter
// ---------------------------------------------------------------------------

/** Hash every file in a folder (sorted by relative path), ignoring .DS_Store.
 *  0894: a file's executable bit is part of its record (a copy whose script
 *  lost +x is not identical), and a symlink inside the skill is hashed by
 *  where it resolves — inside the skill (relative) or outside (absolute) —
 *  not by its link text, so `assets -> ../foo-assets` in two copies that
 *  point at different folders does not count as identical. */
export function hashSkillFolder(dir: string, normalizeSkillMd?: (text: string) => string): string {
  const h = createHash("sha256");
  const rootReal = safeRealpath(dir) ?? resolve(dir);
  const walk = (abs: string, rel: string) => {
    let names: string[];
    try {
      names = readdirSync(abs).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".DS_Store") continue;
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = lstatSync(childAbs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        h.update(`L\0${childRel}\0${linkDestination(childAbs, rootReal)}\0`);
      } else if (st.isDirectory()) {
        h.update(`D\0${childRel}\0`);
        walk(childAbs, childRel);
      } else if (st.isFile()) {
        const raw = readFileSync(childAbs);
        const data = normalizeSkillMd && childRel === "SKILL.md" ? normalizeSkillMd(raw.toString("utf8")) : raw;
        const fh = createHash("sha256").update(data).digest("hex");
        const exec = (st.mode & 0o111) !== 0 ? "x" : "-";
        h.update(`F\0${childRel}\0${exec}\0${fh}\0`);
      }
    }
  };
  walk(dir, "");
  return h.digest("hex");
}

/** Where a symlink inside a skill folder leads, for hashing. */
function linkDestination(linkAbs: string, rootReal: string): string {
  const target = safeRealpath(linkAbs);
  if (target) {
    const rel = relative(rootReal, target);
    const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    return outside ? `out:${target}` : `in:${rel}`;
  }
  let text = "";
  try {
    text = readlinkSync(linkAbs);
  } catch {
    // unreadable link
  }
  return `broken:${resolve(dirname(linkAbs), text)}`;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Minimal YAML frontmatter reader for top-level `name` / `description`,
 *  including folded (`>`) and literal (`|`) block scalars. */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const text = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return null;
  const lines = m[1].split("\n");
  const out: SkillFrontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const km = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!km) continue;
    const key = km[1] as "name" | "description";
    const raw = km[2];
    let value: string;
    if (/^[>|][+-]?\s*$/.test(raw) || raw.trim() === "") {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        block.push(lines[++i].trim());
      }
      value = raw.trim().startsWith("|") ? block.join("\n").trim() : block.filter(Boolean).join(" ").trim();
    } else {
      // A plain or quoted scalar may continue on more-indented lines
      // (YAML folds them with a space); a blank line inside is a line break.
      const parts = [raw.trim()];
      while (
        i + 1 < lines.length &&
        (/^\s+\S/.test(lines[i + 1]) ||
          (lines[i + 1].trim() === "" && i + 2 < lines.length && /^\s+\S/.test(lines[i + 2])))
      ) {
        parts.push(lines[++i].trim());
      }
      let folded = "";
      for (const part of parts) {
        if (part === "") folded += "\n";
        else folded += folded === "" || folded.endsWith("\n") ? part : ` ${part}`;
      }
      value = unquote(folded);
    }
    out[key] = value;
  }
  return out;
}

function readSkillMd(dir: string): string | null {
  try {
    return readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Residue migrate-to-codex leaves: the appended heading on its own line, and
// `.claude/` rewritten to `.Codex/`. A skill that merely mentions the heading
// in prose (migrate-to-codex itself does) is not damaged.
const MIGRATION_MARKERS: Array<[string, RegExp]> = [
  ["## MANUAL MIGRATION REQUIRED", /^## MANUAL MIGRATION REQUIRED\s*$/m],
  [".Codex/", /(^|[\s`"'(~/])\.Codex\//m],
];

// ---------------------------------------------------------------------------
// Lockfile entries
// ---------------------------------------------------------------------------

interface LockEntryLike {
  installedPath?: string;
  pluginDir?: boolean;
  marketplace?: string;
  source?: string;
}

interface LockRecord {
  lockPath: string;
  name: string;
  entry: LockEntryLike;
}

/** Entries of the lockfiles for a scope. Global: ~/.agents/vskill.lock, then
 *  the legacy ~/vskill.lock (names already seen are skipped). Project: the
 *  lock in the scanned project dir. Unreadable locks are skipped. */
function readScopeLocks(scope: DoctorScope, home: string, cwd: string): LockRecord[] {
  const paths = scope === "global"
    ? [join(home, ".agents", "vskill.lock"), join(home, "vskill.lock")]
    : [join(cwd, "vskill.lock")];
  const seen = new Set<string>();
  const out: LockRecord[] = [];
  for (const lockPath of paths) {
    let skills: Record<string, LockEntryLike> | undefined;
    try {
      skills = (JSON.parse(readFileSync(lockPath, "utf8")) as { skills?: Record<string, LockEntryLike> }).skills;
    } catch {
      continue;
    }
    if (!skills || typeof skills !== "object") continue;
    for (const [name, entry] of Object.entries(skills)) {
      if (seen.has(name) || !entry || typeof entry !== "object") continue;
      seen.add(name);
      out.push({ lockPath, name, entry });
    }
  }
  return out;
}

function hasEntries(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** Whether anything a lock entry installed is still on disk: its recorded
 *  install path, a working folder of that name in a scanned dir, a folder
 *  whose frontmatter names it as a plugin namespace (`plugin/skill`), or,
 *  for plugins, a Claude Code plugin cache folder. */
function lockEntryOnDisk(
  name: string,
  entry: LockEntryLike,
  entries: Entry[],
  declared: Map<string, string>,
  home: string,
): boolean {
  if (entry.installedPath && existsSync(entry.installedPath)) return true;
  const leaf = name.split("/").pop() ?? name;
  if (entries.some((e) => e.real && e.name === leaf)) return true;
  for (const n of declared.values()) {
    if (n.startsWith(`${leaf}/`) || n.startsWith(`${leaf}:`)) return true;
  }
  const isPlugin = entry.pluginDir === true || !!entry.marketplace || (entry.source ?? "").startsWith("marketplace:");
  if (!isPlugin) return false;
  const cache = join(home, ".claude", "plugins", "cache");
  if (entry.marketplace && hasEntries(join(cache, entry.marketplace, leaf))) return true;
  let marketplaces: string[] = [];
  try {
    marketplaces = readdirSync(cache);
  } catch {
    return false;
  }
  return marketplaces.some((m) => hasEntries(join(cache, m, leaf)));
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

interface ScopeScan {
  dirs: DirInfo[];
  entries: Entry[];
  issues: DoctorIssue[];
}

function issue(
  kind: DoctorIssueKind,
  scope: DoctorScope,
  skill: string,
  paths: string[],
  message: string,
  fixable: boolean,
  agents?: string[],
): DoctorIssue {
  const out: DoctorIssue = { kind, severity: SEVERITY[kind], scope, skill, paths, message, fixable };
  if (agents && agents.length > 0) out.agents = agents;
  return out;
}

/** A path as `<real parent dir>/<name>`, so two spellings of one entry match. */
function physicalPath(p: string): string {
  return join(safeRealpath(dirname(p)) ?? dirname(p), basename(p));
}

/** Every path a link passes through on its way to the real folder (one
 *  readlink hop at a time), excluding the link itself. */
function linkChain(p: string): string[] {
  const hops: string[] = [];
  let cur = p;
  for (let i = 0; i < 40; i++) {
    let target: string;
    try {
      if (!lstatSync(cur).isSymbolicLink()) break;
      target = readlinkSync(cur);
    } catch {
      break;
    }
    cur = resolve(dirname(cur), target);
    hops.push(physicalPath(cur));
  }
  return hops;
}

function scanScope(
  scope: DoctorScope,
  home: string,
  cwd: string,
  platform: NodeJS.Platform,
  globalReals: ReadonlySet<string> = new Set(),
): ScopeScan {
  const dirs = collectDirs(scope, home, cwd);
  const entries = dirs.flatMap((d) => listEntries(d, home));
  const issues: DoctorIssue[] = [];

  // 1. Broken links.
  for (const e of entries) {
    if (e.isLink && !e.real) {
      let target = "";
      try {
        target = readlinkSync(e.path);
      } catch {
        // unreadable link — still broken
      }
      if (e.unreadable) {
        // Locked folder, unmounted share, I/O error: it may work again, so
        // never delete it.
        issues.push(issue("broken-link", scope, e.name, [e.path],
          `link target ${target || "?"} is unreadable (${e.unreadable}) — left alone`, false));
      } else {
        issues.push(issue("broken-link", scope, e.name, [e.path], `link target ${target || "?"} does not exist`, true));
      }
    }
  }

  // 2. Same folder name as 2+ distinct real folders.
  const realByName = new Map<string, Entry[]>();
  // Folder name → real folders check 2 compared (so check 5 can skip them).
  const checkedPairs = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.isLink || !e.real) continue;
    const list = realByName.get(e.name) ?? [];
    if (!list.some((x) => x.real === e.real)) list.push(e);
    realByName.set(e.name, list);
  }
  for (const [name, list] of realByName) {
    if (list.length < 2) continue;
    checkedPairs.set(name, new Set(list.map((e) => e.real!)));
    const hashes = list.map((e) => hashSkillFolder(e.real!));
    if (new Set(hashes).size > 1) {
      // A Claude Code copy that only adds Claude-only frontmatter is how
      // vskill installs such skills on purpose; it is not drift.
      const strip = (text: string) => stripClaudeFields(text, name);
      if (new Set(list.map((e) => hashSkillFolder(e.real!, strip))).size === 1) continue;
      issues.push(issue("divergent", scope, name, list.map((e) => e.path),
        `${list.length} real copies with different content — merge by hand`, false));
      continue;
    }
    const canonical = list.find((e) => e.dirInfo.shared);
    const ordered = canonical ? [canonical, ...list.filter((e) => e !== canonical)] : list;
    const fixable = !!canonical && platform !== "win32";
    const message = canonical
      ? `${list.length} byte-identical copies — keep ${canonical.path}, link the rest`
      : `${list.length} byte-identical copies, none in the shared .agents/skills folder`;
    issues.push(issue("identical-copy", scope, name, ordered.map((e) => e.path), message, fixable));
  }

  // 3. Redundant links: every reader of the link's dir already sees the same
  //    real folder through another dir it reads. A link already judged
  //    redundant no longer counts as coverage, so two links that only cover
  //    each other are never both removed.
  const redundant = new Set<Entry>();
  const visibleElsewhere = (d: DirInfo, real: string) =>
    entries.some((f) => f.dirInfo === d && f.real === real && !redundant.has(f));
  const dirsByReader = new Map<string, DirInfo[]>();
  for (const d of dirs) {
    for (const r of d.readers) {
      const list = dirsByReader.get(r) ?? [];
      list.push(d);
      dirsByReader.set(r, list);
    }
  }
  // A link that another scanned link passes through is load-bearing: removing
  // it would leave that other link dangling (e.g. ~/.agents/skills/foo ->
  // ../../.codex/skills/foo -> ~/dev/foo), so it is never redundant.
  const throughPaths = new Set<string>();
  for (const f of entries) {
    if (f.isLink) for (const hop of linkChain(f.path)) throughPaths.add(hop);
  }
  for (const e of entries) {
    if (!e.isLink || !e.real || e.dirInfo.shared) continue;
    if (throughPaths.has(join(e.dirInfo.real, e.name))) continue;
    const readers = [...e.dirInfo.readers].sort();
    if (readers.length === 0) continue;
    const covered = readers.every((r) =>
      (dirsByReader.get(r) ?? []).some((d) => d !== e.dirInfo && visibleElsewhere(d, e.real!)),
    );
    if (!covered) continue;
    redundant.add(e);
    issues.push(issue("redundant-link", scope, e.name, [e.path],
      `${readers.join(", ")} already load${readers.length === 1 ? "s" : ""} it from another folder`, true, readers));
  }

  // 4. Per real folder: migration damage, name and description checks.
  const seenReal = new Set<string>();
  const declared = new Map<string, string>(); // real → declared name
  const frontmatterName = new Map<string, string>(); // real → name, when declared
  for (const e of entries) {
    if (!e.real || seenReal.has(e.real)) continue;
    seenReal.add(e.real);
    const md = readSkillMd(e.real);
    if (md === null) continue;
    const folder = e.isLink ? e.name : basename(e.real);
    const shown = e.isLink ? e.path : e.real;
    const markers = MIGRATION_MARKERS.filter(([, re]) => re.test(md)).map(([label]) => label);
    if (markers.length > 0) {
      issues.push(issue("migration-damage", scope, folder, [join(shown, "SKILL.md")],
        `SKILL.md contains ${markers.map((m) => JSON.stringify(m)).join(" and ")} (migrate-to-codex residue)`, false));
    }
    const fm = parseSkillFrontmatter(md);
    const name = fm?.name?.trim();
    declared.set(e.real, name || folder);
    if (!name) {
      issues.push(issue("bad-name", scope, folder, [join(shown, "SKILL.md")], "frontmatter has no name", false));
    } else {
      frontmatterName.set(e.real, name);
      if (name.length > 64 || !NAME_RE.test(name)) {
        issues.push(issue("bad-name", scope, folder, [join(shown, "SKILL.md")],
          `name "${name}" must be lowercase letters, digits and single hyphens, at most 64 chars`, false));
      }
    }
    const desc = fm?.description?.trim() ?? "";
    if (!desc) {
      issues.push(issue("bad-description", scope, folder, [join(shown, "SKILL.md")], "description is missing", false));
    } else if (desc.length > 1024) {
      issues.push(issue("bad-description", scope, folder, [join(shown, "SKILL.md")],
        `description is ${desc.length} chars (max 1024)`, false));
    }
  }

  // 4b. Name vs folder, per folder name an agent actually sees: a link
  //     named `bar` to a folder declaring `foo` is a mismatch even when the
  //     real folder `foo` itself is fine (0894).
  const seenFolderName = new Set<string>();
  for (const e of entries) {
    if (!e.real) continue;
    const name = frontmatterName.get(e.real);
    const folder = e.isLink ? e.name : basename(e.real);
    const key = `${e.real}\0${folder}`;
    if (!name || seenFolderName.has(key)) continue;
    seenFolderName.add(key);
    if (name !== folder) {
      const shown = e.isLink ? e.path : e.real;
      issues.push(issue("name-mismatch", scope, folder, [shown], `frontmatter name "${name}" differs from folder "${folder}"`, false));
    }
  }

  // 5. Two different folders visible to one agent that declare the same
  //    name. Same-folder-name pairs of real folders are covered by check 2;
  //    a pair where one side is a link to a folder outside the scanned dirs
  //    is not, so it is reported here (0894).
  const dupes = new Map<string, { name: string; reals: Map<string, string>; agents: Set<string> }>();
  for (const [reader, readerDirs] of dirsByReader) {
    const byName = new Map<string, Map<string, string>>(); // declared → real → shown path
    for (const d of readerDirs) {
      for (const e of entries) {
        if (e.dirInfo !== d || !e.real) continue;
        const n = declared.get(e.real);
        if (!n) continue;
        const m = byName.get(n) ?? new Map<string, string>();
        if (!m.has(e.real)) m.set(e.real, e.path);
        byName.set(n, m);
      }
    }
    for (const [n, reals] of byName) {
      if (reals.size < 2) continue;
      const folders = new Set([...reals.values()].map((p) => basename(p)));
      if (folders.size < 2) {
        const compared = checkedPairs.get([...folders][0]);
        if (compared && [...reals.keys()].every((r) => compared.has(r))) continue;
      }
      const key = `${n}\0${[...reals.keys()].sort().join("\0")}`;
      const rec = dupes.get(key) ?? { name: n, reals, agents: new Set<string>() };
      rec.agents.add(reader);
      dupes.set(key, rec);
    }
  }
  for (const rec of dupes.values()) {
    const paths = [...rec.reals.values()].sort();
    issues.push(issue("duplicate-name", scope, rec.name, paths,
      `${paths.length} folders declare name "${rec.name}"`, false, [...rec.agents].sort()));
  }

  // 6. Lock entries with nothing on disk: the lock says vskill installed it,
  //    but no scanned folder, recorded install path or plugin cache has it,
  //    so `update` has nothing to refresh. Report only.
  for (const rec of readScopeLocks(scope, home, cwd)) {
    if (lockEntryOnDisk(rec.name, rec.entry, entries, declared, home)) continue;
    const what = rec.entry.pluginDir || rec.entry.marketplace ? "no skill folder or plugin cache" : "no skill folder";
    issues.push(issue("lock-missing", scope, rec.name, [rec.lockPath],
      `in ${basename(rec.lockPath)} but nothing on disk (${what}) — reinstall it or remove the entry`, false));
  }

  // A project folder that is physically a global one (a symlinked dotfiles
  // setup): fixing it from the project would change what every other
  // project sees, so leave the fix to the global scope.
  if (scope === "project" && globalReals.size > 0) {
    const inGlobal = new Set(entries.filter((e) => globalReals.has(e.dirInfo.real)).map((e) => e.path));
    for (const i of issues) {
      if (!i.fixable) continue;
      const touched = i.kind === "identical-copy" ? i.paths.slice(1) : i.paths;
      if (touched.some((p) => inGlobal.has(p))) {
        i.fixable = false;
        i.message += " (folder is also a global skills folder — fix it with --global)";
      }
    }
  }

  return { dirs, entries, issues };
}

// ---------------------------------------------------------------------------
// Fix
// ---------------------------------------------------------------------------

function removeLink(path: string, kind: DoctorIssueKind): DoctorFixAction {
  try {
    if (!lstatSync(path).isSymbolicLink()) {
      return { kind, action: "remove-link", path, ok: false, error: "no longer a link — left alone" };
    }
    if (kind === "broken-link") {
      const { real, code } = resolveLink(path);
      if (real || !code || !GONE_CODES.has(code)) {
        return { kind, action: "archive-link", path, ok: false, error: real ? "link works again — left alone" : `target unreadable (${code}) — left alone` };
      }
      return archiveLink(path, kind);
    }
    unlinkSync(path);
    return { kind, action: "remove-link", path, ok: true };
  } catch (err) {
    return { kind, action: kind === "broken-link" ? "archive-link" : "remove-link", path, ok: false, error: (err as Error).message };
  }
}

/** Move a broken link into `<dir>/_archive/<YYYY-MM-DD>/` (never delete it):
 *  agents and this scan skip `_`-prefixed folders, and the link text stays
 *  readable in case its target comes back. */
function archiveLink(path: string, kind: DoctorIssueKind): DoctorFixAction {
  const day = new Date().toISOString().slice(0, 10);
  const archiveDir = join(dirname(path), "_archive", day);
  let target = join(archiveDir, basename(path));
  for (let i = 2; lexists(target); i++) target = join(archiveDir, `${basename(path)}-${i}`);
  mkdirSync(archiveDir, { recursive: true });
  renameSync(path, target);
  return { kind, action: "archive-link", path, target, ok: true };
}

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Replace a byte-identical real copy with a relative link to the kept copy.
 *  The copy is moved aside first and only deleted once the link resolves to
 *  identical content; any failure restores it. */
function replaceWithLink(copy: string, keep: string, platform: NodeJS.Platform): DoctorFixAction {
  const base: DoctorFixAction = { kind: "identical-copy", action: "replace-with-link", path: copy, target: keep, ok: false };
  if (platform === "win32") return { ...base, error: "links need Developer Mode on Windows — left as a copy" };
  try {
    const st = lstatSync(copy);
    if (st.isSymbolicLink() || !st.isDirectory()) return { ...base, error: "no longer a real folder — left alone" };
    const keepHash = hashSkillFolder(keep);
    if (hashSkillFolder(copy) !== keepHash) return { ...base, error: "content changed since the scan — left alone" };
    // Dot-prefixed: agents and this scan ignore it if anything below stops
    // halfway, so it never shows up as a second copy of the skill.
    const aside = join(dirname(copy), `.${basename(copy)}.vskill-doctor-${process.pid}`);
    renameSync(copy, aside);
    const undo = () => {
      try {
        if (lstatSync(copy).isSymbolicLink()) unlinkSync(copy);
      } catch {
        // nothing at copy
      }
      renameSync(aside, copy);
    };
    try {
      symlinkSync(relative(dirname(copy), keep), copy, "dir");
      if (hashSkillFolder(copy) !== keepHash) throw new Error("new link does not resolve to the kept copy");
      // Anything written into the copy between the scan and the move is in
      // the aside now; deleting it would lose that edit.
      if (hashSkillFolder(aside) !== keepHash) throw new Error("content changed since the scan — left alone");
    } catch (err) {
      undo();
      const code = (err as NodeJS.ErrnoException).code;
      return { ...base, error: code === "EPERM" || code === "EACCES" ? "symlinks not permitted — left as a copy" : (err as Error).message };
    }
    const target = relative(dirname(copy), keep);
    try {
      rmSync(aside, { recursive: true, force: true });
    } catch (err) {
      // The link is in place; only the hidden leftover could not go.
      return { ...base, target, ok: true, error: `linked, but could not remove ${aside}: ${(err as Error).message}` };
    }
    return { ...base, target, ok: true };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

function applyFixes(
  issues: DoctorIssue[],
  platform: NodeJS.Platform,
  failed: Set<string>,
): DoctorFixAction[] {
  const actions: DoctorFixAction[] = [];
  const record = (a: DoctorFixAction) => {
    actions.push(a);
    if (!a.ok) failed.add(a.path);
  };
  for (const i of issues) {
    if (!i.fixable || i.kind !== "identical-copy") continue;
    const [keep, ...copies] = i.paths;
    for (const copy of copies) {
      if (!failed.has(copy)) record(replaceWithLink(copy, keep, platform));
    }
  }
  for (const i of issues) {
    if (!i.fixable || (i.kind !== "broken-link" && i.kind !== "redundant-link")) continue;
    if (!failed.has(i.paths[0])) record(removeLink(i.paths[0], i.kind));
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function resolveScopes(opts: DoctorOptions, home: string, cwd: string): DoctorScope[] {
  const scopes: DoctorScope[] = [];
  const both = !opts.global && !opts.project;
  if (opts.global || both) scopes.push("global");
  // A project scan from $HOME would re-read the global folders.
  if ((opts.project || both) && resolve(cwd) !== resolve(home)) scopes.push("project");
  return scopes;
}

function emptySummary(): Record<DoctorIssueKind, number> {
  return Object.fromEntries(DOCTOR_ISSUE_KINDS.map((k) => [k, 0])) as Record<DoctorIssueKind, number>;
}

function scanAll(scopes: DoctorScope[], home: string, cwd: string, platform: NodeJS.Platform) {
  const globalReals = scopes.includes("project")
    ? new Set(collectDirs("global", home, cwd).map((d) => d.real))
    : new Set<string>();
  const scans = scopes.map((s) => scanScope(s, home, cwd, platform, globalReals));
  return {
    scanned: scans.flatMap((s) =>
      s.dirs.map((d) => ({ scope: d.scope, dir: d.dir, readers: [...d.readers].sort() })),
    ),
    issues: scans.flatMap((s) => s.issues),
  };
}

/** Run the checks (and fixes when `opts.fix`). Pure apart from `--fix`. */
export function runDoctor(opts: DoctorOptions = {}): DoctorReport {
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();
  const platform = opts.platform ?? process.platform;
  const scopes = resolveScopes(opts, home, cwd);

  let { scanned, issues } = scanAll(scopes, home, cwd, platform);
  const fixes: DoctorFixAction[] = [];
  if (opts.fix) {
    // A copy turned into a link can itself become a redundant link, so fix
    // again until a pass changes nothing (bounded).
    const failed = new Set<string>();
    for (let pass = 0; pass < 3; pass++) {
      const actions = applyFixes(issues, platform, failed);
      fixes.push(...actions);
      if (!actions.some((a) => a.ok)) break;
      ({ scanned, issues } = scanAll(scopes, home, cwd, platform));
    }
  }
  const summary = emptySummary();
  for (const i of issues) summary[i.kind]++;
  return { scopes, scanned, issues, fixes, summary, remaining: issues.length };
}

function printReport(report: DoctorReport, fix: boolean): void {
  if (fix && report.fixes.length > 0) {
    console.log(bold("Fixes"));
    for (const f of report.fixes) {
      const what =
        f.action === "remove-link" ? `removed link ${f.path}`
          : f.action === "archive-link" ? `moved broken link ${f.path} to ${f.target}`
            : `linked ${f.path} -> ${f.target}`;
      const note = f.ok && f.error ? dim(` (${f.error})`) : "";
      console.log(f.ok ? `  ${green("done")} ${what}${note}` : `  ${yellow("skip")} ${f.path}: ${f.error}`);
    }
    console.log("");
  }

  const dirCount = report.scanned.length;
  console.log(dim(`Scanned ${dirCount} skills folder${dirCount === 1 ? "" : "s"} (${report.scopes.join(" + ") || "no scope"})`));
  if (report.issues.length === 0) {
    console.log(green("No problems found."));
    return;
  }

  for (const kind of DOCTOR_ISSUE_KINDS) {
    const list = report.issues.filter((i) => i.kind === kind);
    if (list.length === 0) continue;
    const color = SEVERITY[kind] === "error" ? red : yellow;
    console.log("");
    console.log(color(bold(`${kind} (${list.length})`)) + (list[0].fixable ? dim("  fixable with --fix") : ""));
    for (const i of list) {
      console.log(`  ${color(SEVERITY[kind])} ${bold(i.skill)} ${dim(`[${i.scope}]`)} ${i.message}`);
      for (const p of i.paths) console.log(`    ${dim(p)}`);
      if (i.agents) console.log(`    ${dim(`agents: ${i.agents.join(", ")}`)}`);
    }
  }

  const fixable = report.issues.filter((i) => i.fixable).length;
  console.log("");
  console.log(
    `${bold(String(report.issues.length))} problem${report.issues.length === 1 ? "" : "s"}` +
      (fixable > 0 && !fix ? `, ${cyan(String(fixable))} fixable with ${cyan("vskill doctor --fix")}` : ""),
  );
}

export async function doctorCommand(opts: DoctorOptions): Promise<void> {
  const report = runDoctor(opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, !!opts.fix);
  }
  process.exitCode = report.remaining === 0 ? 0 : 1;
}
