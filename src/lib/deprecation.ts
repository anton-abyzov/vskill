// ---------------------------------------------------------------------------
// Skill deprecation with a replacement pointer (increment 1486).
//
// A skill marks itself deprecated with flat string keys directly under a
// block-style `metadata:` mapping (the Agent Skills spec keeps metadata
// string-to-string; the version already lives in metadata.version):
//
//   metadata:
//     version: "1.0.5"
//     deprecated: "true"
//     deprecated-message: "A smoke-test fixture, not a user skill."
//     replaced-by: "none"            # | mcp:<server>[:tool] | <owner>/<repo>/<skill>
//     deprecated-since: "1.0.5"
//
// Nothing here removes or overwrites a skill: callers only print notices.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveInstallPath } from "../eval/disk-version.js";
import { getPluginSource } from "../marketplace/index.js";
import { parseSource } from "../resolvers/source-resolver.js";
import type { SkillLockEntry } from "../lockfile/types.js";
import { yellow } from "../utils/output.js";
import { githubFetch } from "./github-fetch.js";

export interface SkillDeprecation {
  message: string;
  /** "none", "mcp:<server>[:tool]" or "<owner>/<repo>/<skill>". */
  replacedBy: string;
  since?: string;
}

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_ALL_RE = /(?:^|\n)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/g;

function scalar(raw: string): string {
  const value = raw.trim().match(/^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^#]*))/);
  if (!value) return "";
  if (value[1] !== undefined) return value[1].replace(/\\(["\\])/g, "$1");
  if (value[2] !== undefined) return value[2].replace(/''/g, "'");
  return (value[3] ?? "").trim();
}

/** Direct children of a block-style `metadata:` mapping, as raw strings. */
function metadataChildren(frontmatter: string): Map<string, string> {
  const lines = frontmatter.split(/\r?\n/);
  const out = new Map<string, string>();
  const start = lines.findIndex((line) => /^metadata[ \t]*:[ \t]*(?:#.*)?$/.test(line));
  if (start < 0) return out;
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s|^#/.test(lines[end]))) end++;
  const children = lines.slice(start + 1, end);
  const indents = children
    .filter((line) => /^ +[^ #]/.test(line))
    .map((line) => line.length - line.trimStart().length);
  if (indents.length === 0) return out;
  const indent = Math.min(...indents);
  for (const line of children) {
    if (line.length - line.trimStart().length !== indent) continue;
    const m = line.slice(indent).match(/^([A-Za-z0-9_.-]+)[ \t]*:(.*)$/);
    if (!m) continue;
    // An empty value opens a nested mapping or list: not a flat string key.
    const value = scalar(m[2]);
    if (!m[2].trim()) continue;
    if (!out.has(m[1])) out.set(m[1], value);
  }
  return out;
}

function fromFrontmatter(frontmatter: string): SkillDeprecation | null {
  const meta = metadataChildren(frontmatter);
  if ((meta.get("deprecated") ?? "").toLowerCase() !== "true") return null;
  const since = meta.get("deprecated-since");
  return {
    message: meta.get("deprecated-message") ?? "",
    replacedBy: meta.get("replaced-by") || "none",
    ...(since ? { since } : {}),
  };
}

function frontmatterName(frontmatter: string): string | undefined {
  const m = frontmatter.match(/^name[ \t]*:(.*)$/m);
  const name = m ? scalar(m[1]) : "";
  return name ? name.slice(name.lastIndexOf("/") + 1) : undefined;
}

/** The deprecation a SKILL.md declares, or null. Never throws. */
export function readDeprecation(content: string | null | undefined): SkillDeprecation | null {
  if (typeof content !== "string") return null;
  const fm = content.match(FRONTMATTER_RE);
  return fm ? fromFrontmatter(fm[1]) : null;
}

/**
 * Every deprecated skill in content that may join several SKILL.md files
 * (plugin installs combine them). `name` is the frontmatter name, when set.
 */
export function readDeprecations(
  content: string | null | undefined,
): Array<{ name?: string; deprecation: SkillDeprecation }> {
  if (typeof content !== "string") return [];
  const out: Array<{ name?: string; deprecation: SkillDeprecation }> = [];
  for (const m of content.replace(/^\uFEFF/, "").matchAll(FRONTMATTER_ALL_RE)) {
    const deprecation = fromFrontmatter(m[1]);
    if (deprecation) out.push({ name: frontmatterName(m[1]), deprecation });
  }
  return out;
}

/** The deprecation an installed SKILL.md on disk declares, or null. */
export function readInstalledDeprecation(skillMdPath: string | null | undefined): SkillDeprecation | null {
  if (!skillMdPath) return null;
  try {
    return readDeprecation(readFileSync(skillMdPath, "utf8"));
  } catch {
    return null;
  }
}

/** "none" reads as "no replacement"; anything else is shown as written. */
export function describeReplacement(replacedBy: string): string {
  return replacedBy === "none" ? "none (no replacement)" : replacedBy;
}

/** One line: "<name> is deprecated since X: <message> Replaced by: <r>." */
export function formatDeprecation(name: string, d: SkillDeprecation): string {
  const message = d.message.trim();
  const sentence = message ? (/[.!?]$/.test(message) ? message : `${message}.`) : "No reason given.";
  return `${name} is deprecated${d.since ? ` since ${d.since}` : ""}: ${sentence} Replaced by: ${describeReplacement(d.replacedBy)}.`;
}

/** The printed notice: a warning line; nothing is removed or overwritten. */
export function deprecationNotice(name: string, d: SkillDeprecation): string {
  return yellow(`⚠ ${formatDeprecation(name, d)}`);
}

/**
 * Print a notice for every deprecated skill in installed content (one SKILL.md
 * or a plugin's combined files). `fallbackName` names a skill whose
 * frontmatter has no name. The install itself goes ahead unchanged.
 */
export function printDeprecationsIn(content: string | null | undefined, fallbackName: string): void {
  try {
    for (const d of readDeprecations(content)) console.log(deprecationNotice(d.name ?? fallbackName, d.deprecation));
  } catch {
    // A notice must never break an install.
  }
}

/** JSON shape for `--json` outputs. */
export function deprecationJson(d: SkillDeprecation): { message: string; replacedBy: string; since?: string } {
  return { message: d.message, replacedBy: d.replacedBy, ...(d.since ? { since: d.since } : {}) };
}

// ---------------------------------------------------------------------------
// Upstream reads: what the source serves now, so an install that predates
// the field still learns about it. raw.githubusercontent.com only, bounded
// by a timeout; any failure is "no claim".
// ---------------------------------------------------------------------------

export type FetchText = (url: string) => Promise<string | null>;

export const UPSTREAM_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

const defaultFetchText: FetchText = async (url) => {
  const res = await githubFetch(url);
  return res.ok ? await res.text() : null;
};

/**
 * The SKILL.md files the source of a lock entry serves now: one for a
 * single-skill GitHub install, one per installed skill folder for a plugin
 * install. Other source types (registry, local, private) return [].
 */
export async function fetchUpstreamSkillMds(
  name: string,
  entry: SkillLockEntry,
  opts: { fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<Array<{ skill: string; content: string }>> {
  if (entry.sourcePrivate || entry.hostedPrivate) return [];
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const get = (url: string) => withTimeout((opts.fetchText ?? defaultFetchText)(url), timeoutMs, null);
  const parsed = parseSource(entry.source ?? "");
  // "HEAD" resolves to the default branch on raw.githubusercontent.com
  // without a REST call (installs read the default branch, usually main).
  const branch = entry.sourceBranch || "HEAD";
  const skillName = name.slice(name.lastIndexOf("/") + 1);

  if (parsed.type === "github") {
    const base = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}`;
    const paths = [entry.sourceSkillPath, `skills/${skillName}/SKILL.md`, "SKILL.md"].filter(
      (p): p is string => !!p,
    );
    for (const path of paths) {
      const content = await get(`${base}/${path}`);
      if (!content) continue;
      // A fallback path may serve another skill: only trust a matching name.
      const fm = content.match(FRONTMATTER_RE);
      const declared = fm ? frontmatterName(fm[1]) : undefined;
      if (path !== entry.sourceSkillPath && declared && declared !== skillName) continue;
      return [{ skill: skillName, content }];
    }
    return [];
  }

  if (parsed.type === "github-plugin" || parsed.type === "marketplace") {
    const base = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}`;
    const manifest = await get(`${base}/.claude-plugin/marketplace.json`);
    if (!manifest) return [];
    let source: string | null = null;
    try {
      source = getPluginSource(parsed.pluginName, manifest);
    } catch {
      return [];
    }
    if (source === null) return [];
    const prefix = source.replace(/^\.\/?/, "").replace(/\/+$/, "");
    const dirs = new Set<string>(entry.skills ?? []);
    for (const f of entry.files ?? []) {
      const m = f.match(/^([^/]+)\/SKILL\.md$/);
      if (m) dirs.add(m[1]);
    }
    const results = await Promise.all(
      [...dirs].map(async (dir) => {
        const content = await get(`${base}/${prefix ? `${prefix}/` : ""}skills/${dir}/SKILL.md`);
        return content ? { skill: dir, content } : null;
      }),
    );
    return results.filter((r): r is { skill: string; content: string } => r !== null);
  }

  return [];
}

/** Deprecations the source of a lock entry declares now, keyed by skill folder. */
export async function fetchUpstreamDeprecations(
  name: string,
  entry: SkillLockEntry,
  opts: { fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<Array<{ skill: string; deprecation: SkillDeprecation }>> {
  try {
    const files = await fetchUpstreamSkillMds(name, entry, opts);
    return files.flatMap(({ skill, content }) => {
      const deprecation = readDeprecation(content);
      return deprecation ? [{ skill, deprecation }] : [];
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lock-wide scan: the installed copies plus, optionally, their sources.
// ---------------------------------------------------------------------------

export interface DeprecationFinding {
  /** Lock entry name (a plugin name for plugin installs). */
  name: string;
  /** Skill folder that is deprecated. */
  skill: string;
  deprecation: SkillDeprecation;
  /** Where it was read: the installed SKILL.md or the source's current one. */
  origin: "installed" | "source";
}

function isPluginEntry(entry: SkillLockEntry): boolean {
  const t = parseSource(entry.source ?? "").type;
  return t === "github-plugin" || t === "marketplace" || !!entry.pluginDir;
}

/** SKILL.md paths on disk for a lock entry, keyed by skill folder. */
export function installedSkillMdPaths(name: string, entry: SkillLockEntry, lockDir: string): Array<{ skill: string; path: string }> {
  if (!isPluginEntry(entry)) {
    return [{ skill: name.slice(name.lastIndexOf("/") + 1), path: resolveInstallPath({ name, entry, lockDir }) }];
  }
  const dirs = new Set<string>(entry.skills ?? []);
  for (const f of entry.files ?? []) {
    const m = f.match(/^([^/]+)\/SKILL\.md$/);
    if (m) dirs.add(m[1]);
  }
  return [...dirs].map((skill) => {
    const candidates = [
      ...(entry.installedPath ? [join(entry.installedPath, skill, "SKILL.md"), join(entry.installedPath, "skills", skill, "SKILL.md")] : []),
      resolveInstallPath({ name: skill, entry: { ...entry, installedPath: undefined }, lockDir }),
    ];
    return { skill, path: candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1] };
  });
}

/**
 * Deprecated skills among lock entries. The source's current SKILL.md wins
 * over the installed copy, so an install that predates the field is flagged.
 * `upstream: false` reads only the installed copies (no network).
 */
export async function collectDeprecations(
  entries: Array<{ name: string; entry: SkillLockEntry; lockDir: string }>,
  opts: { upstream?: boolean; fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<DeprecationFinding[]> {
  const perEntry = await Promise.all(
    entries.map(async ({ name, entry, lockDir }) => {
      const found = new Map<string, DeprecationFinding>();
      for (const { skill, path } of installedSkillMdPaths(name, entry, lockDir)) {
        const d = readInstalledDeprecation(path);
        if (d) found.set(skill, { name, skill, deprecation: d, origin: "installed" });
      }
      if (opts.upstream) {
        for (const { skill, deprecation } of await fetchUpstreamDeprecations(name, entry, opts)) {
          found.set(skill, { name, skill, deprecation, origin: "source" });
        }
      }
      return [...found.values()];
    }),
  );
  return perEntry.flat();
}
